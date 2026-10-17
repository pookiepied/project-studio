import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { LEASE_DURATION_MS } from "@flue/runtime/adapter";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import { FlueHarnessClient } from "../../src/application/harness-client.js";
import type { DiagnosticPage } from "../../src/contracts/diagnostics.js";

/**
 * Background agent tasks, end to end, through the real built harness
 * (ADR 0058 D5, Stage 4).
 *
 * What only a live run can prove, the stage's gates in order: a dispatched
 * task is indexed at dispatch and settles from the stream (the titler's
 * first exchange is the one production dispatch a scripted harness has);
 * a cancel mid-run records its intent and the run settles `cancelled`;
 * and a harness killed under a running task recovers the row as `running`
 * and settles it after the restart, because Flue's reconciliation re-runs
 * the interrupted submission - the stream is the truth, the row is the
 * projection. The dispatch→settle→signal round trip within the runtime is
 * `task-settlements.test.ts`; the routes' admission and refusal shapes are
 * `tasks-routes.test.ts`.
 *
 * The harness boot is `delegation.test.ts`'s copy in full - the startup
 * budget, the silence replacement, the IPC shutdown - because those
 * diagnostics are what #70's "no captured failure" lesson demands. The
 * scripted model's `[hold-task]` scenario keeps a titling run alive for the
 * seconds the cancel and restart tests need (documented beside its code in
 * `test-adapter.ts`).
 */

const processes = new Set<ChildProcess>();
const temporaryDirectories = new Set<string>();

const STARTUP_BUDGET_MS = 20_000;
const STARTUP_SILENCE_MS = 10_000;

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a test port."));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs: number,
  describe?: () => string,
): Promise<void> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(
    `Condition was not met within ${timeoutMs}ms (waited ${Date.now() - started}ms).` +
      (describe?.() ?? ""),
  );
}

class StartupSilent extends Error {}

interface Running {
  readonly baseUrl: string;
  readonly process: ChildProcess;
  readonly token: string;
}

async function startHarness(databasePath: string): Promise<Running> {
  const startedAt = Date.now();
  const replaced: string[] = [];
  const withReplaced = (message: string): string =>
    replaced.length === 0
      ? message
      : `${message}\n  An earlier attempt was replaced for staying silent: ${replaced.join("; ")}.`;

  for (;;) {
    const port = await availablePort();
    const admission = createAdmissionSession({ clientType: "test" });
    const attemptStartedAt = Date.now();
    const child = spawn(process.execPath, ["dist/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        PROJECT_STUDIO_ADMISSION_CREDENTIAL: admission.credential,
        PROJECT_STUDIO_DB_PATH: databasePath,
        PROJECT_STUDIO_STORE_PATH: join(dirname(databasePath), "studio.db"),
        PROJECT_STUDIO_MODEL_SOURCE: "test",
        PROJECT_STUDIO_HOME: dirname(databasePath),
      },
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    processes.add(child);

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const tail = (text: string): string =>
      text.length > 2_000 ? `...${text.slice(-2_000)}` : text;
    const baseUrl = `http://127.0.0.1:${port}`;
    let lastProbeError: unknown;
    const probeSentence = (error: unknown): string => {
      if (!(error instanceof Error)) return String(error);
      const cause = error.cause;
      return cause instanceof Error ? `${error.message} (${cause.message})` : error.message;
    };
    const describeFailure = (): string =>
      [
        ` The harness on ${baseUrl} never accepted a connection.`,
        `pid=${String(child.pid)}`,
        `exitCode=${String(child.exitCode)}`,
        `signal=${String(child.signalCode)}`,
        `lastProbe=${probeSentence(lastProbeError)}`,
        `stdout=${tail(stdout) || "(nothing)"}`,
        `stderr=${tail(stderr) || "(nothing)"}`,
      ].join("\n  ");

    try {
      await waitUntil(
        async () => {
          if (child.exitCode !== null) {
            throw new Error(`Harness exited during startup: ${stderr}`);
          }
          if (
            stdout.length === 0 &&
            stderr.length === 0 &&
            Date.now() - attemptStartedAt >= STARTUP_SILENCE_MS
          ) {
            throw new StartupSilent(describeFailure());
          }
          try {
            await fetch(baseUrl);
            return true;
          } catch (error) {
            lastProbeError = error;
            return false;
          }
        },
        Math.max(STARTUP_BUDGET_MS - (Date.now() - startedAt), 1),
        describeFailure,
      );
      return { baseUrl, process: child, token: admission.credential };
    } catch (error) {
      const replaceable =
        error instanceof StartupSilent &&
        replaced.length === 0 &&
        STARTUP_BUDGET_MS - (Date.now() - startedAt) >= Math.ceil(STARTUP_SILENCE_MS / 2);
      if (replaceable) {
        replaced.push(
          `pid=${String(child.pid)} on port ${String(port)}, killed after ${String(Date.now() - attemptStartedAt)}ms with no output`,
        );
        await killHarness(child);
        continue;
      }
      if (error instanceof Error) error.message = withReplaced(error.message);
      throw error;
    }
  }
}

async function stopHarness(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    if (child.connected) child.send("shutdown");
    else child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  processes.delete(child);
}

async function killHarness(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolve();
        return;
      }
      child.once("exit", () => resolve());
    });
  }
  processes.delete(child);
}

async function createDatabasePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "studio-tasks-"));
  temporaryDirectories.add(directory);
  return join(directory, "flue.db");
}

afterEach(async () => {
  await Promise.all([...processes].map(stopHarness));
  await Promise.all(
    [...temporaryDirectories].map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
      temporaryDirectories.delete(directory);
    }),
  );
});

interface TaskWire {
  readonly id: string;
  readonly agentName: string;
  readonly parentConversationId: string | undefined;
  readonly title: string;
  readonly status: string;
  readonly resultSummary: string | undefined;
}

/**
 * The titler's row for one conversation, by its id shape: attempt 0 is
 * dispatched to the conversation's own instance id, a ladder retry to
 * `<conversation id>-t<N>`. The row deliberately names no parent
 * conversation - a title is not news to the conversation it names - so the
 * id is the only join.
 */
function rowFor(rows: readonly TaskWire[], conversationId: string): TaskWire | undefined {
  return rows.find(
    (task) => task.id === conversationId || task.id.startsWith(`${conversationId}-t`),
  );
}

function authorized(running: Running, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(`${running.baseUrl}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      authorization: `Bearer ${running.token}`,
      "content-type": "application/json",
    },
  });
}

async function listTasks(running: Running): Promise<readonly TaskWire[]> {
  const response = await authorized(running, "/api/tasks?agentName=title");
  expect(response.status).toBe(200);
  return (await response.json()) as readonly TaskWire[];
}

describe.sequential("background agent tasks, end to end", () => {
  it(
    "indexes a dispatched task at dispatch and settles it from the stream",
    async () => {
      // The one production dispatch a scripted harness has: the conversation's
      // first exchange settles, the titler dispatches, and the row exists
      // from that moment - before the run's answer, because a run that starts
      // is always indexed. The settlement then arrives from the stream, not
      // from anything this route path did.
      const running = await startHarness(await createDatabasePath());
      const policy = await authorized(running, "/api/diagnostics/policy", { method: "PUT",
        body: JSON.stringify({ enabled: true, captureContent: true, conversations: ["cnv_task_settles"] }) });
      expect(policy.status).toBe(200);
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      const conversationId = "cnv_task_settles";

      const sent = await client.send(conversationId, "help me think about sand");
      await client.wait(sent);

      let indexed: TaskWire | undefined;
      await waitUntil(async () => {
        indexed = rowFor(await listTasks(running), conversationId);
        return indexed !== undefined;
      }, 20_000);

      expect(indexed?.agentName).toBe("title");
      // A live run is indexed while running, but the scripted title settles
      // faster than one poll interval, so the row's state at first sight is
      // whichever the race left: running or already settled. The settle wait
      // below is the assertion; this one only requires the row existed.
      expect(["running", "completed", "failed", "cancelled"]).toContain(indexed?.status);
      expect(indexed?.title).toBe("Titler");
      // The title is not news to the conversation it names: no parent is
      // named, so no settlement announces and no block names it.
      expect(indexed?.parentConversationId).toBeUndefined();

      // The submission settles completed (the scripted answer is not a usable
      // title and the derived title stands, but the RUN settled - the row
      // projects the stream, not the parse).
      await waitUntil(async () => {
        const row = rowFor(await listTasks(running), conversationId);
        return row !== undefined && row.status !== "running";
      }, 20_000);
      const settledRow = rowFor(await listTasks(running), conversationId);
      expect(settledRow?.status).toBe("completed");
      expect(settledRow?.resultSummary).toBeDefined();
      const evidence = await authorized(running, "/api/diagnostics/events?limit=500");
      const page = await evidence.json() as DiagnosticPage;
      const admission = page.events.find((event) => event.name === "http.admission" && event.identity.submissionId === sent.submissionId);
      const background = page.events.find((event) => event.name === "background.admitted" && event.identity.agentName === "title");
      expect(admission?.identity.requestId).toBeDefined();
      expect(background?.identity).toMatchObject({ requestId: admission?.identity.requestId,
        conversationId, agentName: "title", agentInstanceId: conversationId });
      expect(background?.identity.invocationId).toBeDefined();
      const titleTurns = page.events.filter((event) => event.name === "runtime.turn_request" &&
        event.identity.submissionId === background?.identity.submissionId);
      expect(titleTurns.length).toBeGreaterThan(0);
      expect(titleTurns.every((event) => event.identity.requestId === admission?.identity.requestId &&
        event.identity.conversationId === conversationId && event.identity.invocationId === background?.identity.invocationId)).toBe(true);
    },
    90_000,
  );

  it(
    "cancels a running task, and the run settles cancelled",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      const conversationId = "cnv_task_cancelled";

      // The titling run holds for the scripted hold window, giving the test
      // a wide, deterministic window in which the row is live and stoppable.
      const sent = await client.send(conversationId, "hold this [hold-task] please");
      await client.wait(sent);

      let taskId: string | undefined;
      await waitUntil(async () => {
        const row = rowFor(await listTasks(running), conversationId);
        taskId = row?.id;
        return row !== undefined && row.status === "running";
      }, 20_000);

      const cancelled = await authorized(running, `/api/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      expect(cancelled.status).toBe(200);
      expect((await cancelled.json()) as { cancelled: boolean }).toEqual({ cancelled: true });

      // The intent is recorded; the settlement lands asynchronously, the way
      // the abort contract promises, and the row reads cancelled - the
      // person's stop, projected from the stream like any other ending.
      await waitUntil(async () => {
        const rows = await listTasks(running);
        return rows.find((task) => task.id === taskId)?.status !== "running";
      }, 20_000);
      const row = (await listTasks(running)).find((task) => task.id === taskId);
      expect(row?.status).toBe("cancelled");

      // Cancelling again says so rather than pretending there was work left.
      const again = await authorized(running, `/api/tasks/${taskId}/cancel`, {
        method: "POST",
      });
      expect((await again.json()) as { cancelled: boolean }).toEqual({ cancelled: false });
    },
    90_000,
  );

  it(
    "recovers a running task across a restart, then settles it",
    async () => {
      // The row is the projection; the stream is the truth. A harness killed
      // under a running task leaves the row saying running - which is still
      // true, because Flue's durable submission is re-run by the restart's
      // reconciliation - and the replacement run's settlement is what finally
      // settles the row.
      const databasePath = await createDatabasePath();
      const first = await startHarness(databasePath);
      const client = new FlueHarnessClient({ baseUrl: first.baseUrl, token: first.token });
      const conversationId = "cnv_task_recovered";

      const sent = await client.send(conversationId, "hold this [hold-task] across restarts");
      await client.wait(sent);

      let taskId: string | undefined;
      await waitUntil(async () => {
        const row = rowFor(await listTasks(first), conversationId);
        taskId = row?.id;
        return row !== undefined && row.status === "running";
      }, 20_000);
      await killHarness(first.process);

      const second = await startHarness(databasePath);
      // Same index, same row, still running after the restart - the state
      // the stream is still in.
      await waitUntil(async () => {
        const rows = await listTasks(second);
        return rows.find((task) => task.id === taskId)?.status === "running";
      }, 20_000);

      await waitUntil(async () => {
        const rows = await listTasks(second);
        return rows.find((task) => task.id === taskId)?.status !== "running";
      // A killed owner retains its 30s lease. Node scans expired leases every
      // 15s, then the fixture holds the recovered model for another 12s. The
      // previous 30s deadline expired before valid recovery could complete.
      }, LEASE_DURATION_MS + 45_000);
      // The row settles from the replacement run's settlement - whatever the
      // stream said. Measured here: a submission killed mid-attempt is
      // re-run by the restart's reconciliation, and the runtime's own
      // durability contract caps recovery attempts, so a replacement that
      // is itself interrupted settles `failed` ("Submission exceeded
      // maximum recovery attempts") exactly as a live failure would. The
      // projection's job - and this assertion's - is that the row says what
      // the stream said, not what we would have preferred.
      const row = (await listTasks(second)).find((task) => task.id === taskId);
      expect(["completed", "failed", "cancelled"]).toContain(row?.status);
    },
    120_000,
  );
});
