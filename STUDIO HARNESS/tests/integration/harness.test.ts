import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FlueConversationMessage, FlueConversationSnapshot } from "@flue/sdk";
import { afterEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import {
  FlueHarnessClient,
  type AcceptedRun,
} from "../../src/application/harness-client.js";

interface RunningHarness {
  baseUrl: string;
  process: ChildProcess;
  token: string;
}

const processes = new Set<ChildProcess>();
const temporaryDirectories = new Set<string>();

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

      server.close((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(address.port);
        }
      });
    });
  });
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 15_000,
  describe?: () => string,
): Promise<void> {
  const started = Date.now();
  const deadline = started + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // The detail is the point of this change. This condition has now expired
  // twice in full-suite runs, and both reports said only that a number had been
  // exceeded — so both times the cause stayed unknown and `E-02` could only
  // guess at it. A deadline that expires without saying what it was waiting on
  // is a failure that cannot be diagnosed from its own message.
  throw new Error(
    `Condition was not met within ${timeoutMs}ms (waited ${Date.now() - started}ms).` +
      (describe?.() ?? ""),
  );
}

/**
 * How long the harness gets to accept its first connection.
 *
 * A healthy boot speaks within seconds: across roughly a hundred harness
 * starts measured for Task 28 (full suites, single-file runs, bare spawns),
 * the first byte landed between 2.0s and 6.4s, cold or under load. This is
 * not a threshold anything is expected to approach, and raising it is
 * explicitly **not** the fix for `E-02` — the report above is. It is set far
 * beyond any plausible boot so that when it does expire, the machine was
 * genuinely wedged and the message says so.
 *
 * **It must stay below the smallest enclosing test timeout.** This was 60s
 * while six of the tests below run under a 30s timeout, which meant vitest
 * killed those tests half a minute *before* this budget expired: the report
 * above — pid, exit code, last probe error, stdout and stderr — could not
 * print for two thirds of the file, and the failure arrived as a bare "test
 * timed out" with nothing attached. A diagnostic that cannot fire is not a
 * diagnostic.
 */
const STARTUP_BUDGET_MS = 20_000;

/**
 * When a silent child gets replaced instead of waited on.
 *
 * The full-suite failures behind this constant were children that sat alive
 * with not one byte on either pipe for the whole budget: never refused a port,
 * never exited, never logged. A child that cannot produce a byte in 10s —
 * over 1.5x the slowest of those hundred measured healthy boots — is not
 * starting slowly; it is wedged, and waiting longer has never once turned one
 * into a pass. So there is exactly one replacement attempt, on a fresh port,
 * inside the same budget: an episodic machine stall costs one dead child,
 * while a genuine regression still fails, now carrying both attempts in its
 * message. A child that *exits* is never replaced — its stderr already says
 * why it died.
 */
const STARTUP_SILENCE_MS = 10_000;

/**
 * Thrown by a start attempt whose child stayed silent past the window. It
 * never reaches a test: `startHarness` consumes it when a replacement attempt
 * is possible and folds its detail into the final failure otherwise.
 */
class StartupSilent extends Error {}

/** Everything a start attempt may override, for tests of this machinery. */
interface HarnessStartOptions {
  readonly entry?: string;
  readonly startupBudgetMs?: number;
  readonly startupSilenceMs?: number;
}

async function startHarness(
  databasePath: string,
  options: HarnessStartOptions = {},
): Promise<RunningHarness> {
  const budgetMs = options.startupBudgetMs ?? STARTUP_BUDGET_MS;
  const silenceMs = options.startupSilenceMs ?? STARTUP_SILENCE_MS;
  const startedAt = Date.now();
  /** Attempts replaced for silence, named in any later failure. */
  const replaced: string[] = [];

  const withReplacedAttempts = (message: string): string =>
    replaced.length === 0
      ? message
      : `${message}\n  An earlier attempt was replaced for staying silent: ${replaced.join("; ")}.`;

  for (;;) {
    const port = await availablePort();
    const admission = createAdmissionSession({ clientType: "test" });
    const attemptStartedAt = Date.now();
    const child = spawn(process.execPath, [options.entry ?? "dist/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(port),
        PROJECT_STUDIO_ADMISSION_CREDENTIAL: admission.credential,
        PROJECT_STUDIO_DB_PATH: databasePath,
        PROJECT_STUDIO_STORE_PATH: join(dirname(databasePath), "studio.db"),
      },
      // An IPC channel alongside the pipes, so shutdown can be *requested* on
      // Windows. `SIGTERM` there maps to TerminateProcess and never reaches a
      // handler, which is why the harness listens for a message as well.
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });
    processes.add(child);

    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    // Captured as well as stderr, because the harness reports its own startup on
    // stdout. Whether it got as far as saying anything is the first thing worth
    // knowing about a start that never finished — and a byte on either stream
    // is what marks a slow boot as alive instead of wedged.
    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    /** The last of a stream, which is where the reason for a bad start is. */
    const tail = (text: string): string =>
      text.length > 2_000 ? `…${text.slice(-2_000)}` : text;

    const baseUrl = `http://127.0.0.1:${port}`;
    /** Kept so the failure can say what the last attempt actually objected to. */
    let lastProbeError: unknown;
    const describeFailure = (): string =>
      [
        ` The harness on ${baseUrl} never accepted a connection.`,
        `pid=${String(child.pid)}`,
        `exitCode=${String(child.exitCode)}`,
        `signal=${String(child.signalCode)}`,
        // A port taken between allocation and use is the other way this fails,
        // and it looks nothing like a slow boot once the message says so.
        `lastProbe=${lastProbeError instanceof Error ? lastProbeError.message : String(lastProbeError)}`,
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
            Date.now() - attemptStartedAt >= silenceMs
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
        Math.max(budgetMs - (Date.now() - startedAt), 1),
        describeFailure,
      );

      return { baseUrl, process: child, token: admission.credential };
    } catch (error) {
      // One replacement, and only while enough of the budget remains for the
      // next attempt to be fair; otherwise the failure carries everything known.
      const replaceable =
        error instanceof StartupSilent &&
        replaced.length === 0 &&
        budgetMs - (Date.now() - startedAt) >= Math.ceil(silenceMs / 2);
      if (replaceable) {
        replaced.push(
          `pid=${String(child.pid)} on port ${String(port)}, killed after ${String(Date.now() - attemptStartedAt)}ms with no output`,
        );
        await killHarness(child);
        continue;
      }
      if (error instanceof Error) error.message = withReplacedAttempts(error.message);
      throw error;
    }
  }
}

async function stopHarness(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    // Ask over IPC when there is a channel, because a signal cannot carry this
    // on Windows. `SIGTERM` remains the fallback for a child without one.
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
  const directory = await mkdtemp(join(tmpdir(), "project-studio-v2-"));
  temporaryDirectories.add(directory);
  return join(directory, "flue.db");
}

function textFromMessage(message: FlueConversationMessage): string {
  return message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

/**
 * How many provider attempts a submission actually made, read back from
 * history rather than assumed: every attempt appends its own assistant record,
 * and the records belonging to one submission are exactly the assistants that
 * follow its user message. Position is the only honest association — history
 * snapshots carry no submissionId on assistant messages (Task 26), so this is
 * the same fact the Studio projection uses on cold starts.
 */
function attemptCount(history: FlueConversationSnapshot, userTextIncludes: string): number {
  const anchor = history.messages.findIndex(
    (message) =>
      message.role === "user" && textFromMessage(message).includes(userTextIncludes),
  );
  if (anchor === -1) {
    throw new Error(`No user message matching ${JSON.stringify(userTextIncludes)} in history.`);
  }
  let attempts = 0;
  for (const message of history.messages.slice(anchor + 1)) {
    if (message.role !== "assistant") break;
    attempts += 1;
  }
  return attempts;
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

describe.sequential("Flue harness vertical slice", () => {
  it(
    "accepts a run, streams renderable state, and keeps thread continuity",
    async () => {
      const running = await startHarness(await createDatabasePath());
       const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      const observation = client.observe("continuity");

      const first = await client.send("continuity", "hello");
      expect(first.submissionId).not.toBe("");
      expect((await client.wait(first)).text).toBe("Echo: hello");

      observation.refresh();
      await waitUntil(async () => {
        const messages = observation.getSnapshot().conversation?.messages ?? [];
        return messages.some(
          (message) => textFromMessage(message) === "Echo: hello",
        );
      });

      const second = await client.send("continuity", "again");
      expect((await client.wait(second)).text).toBe("Echo: again");
      const history = await client.history("continuity");
      expect(history.messages.length).toBeGreaterThanOrEqual(4);

      observation.close();
    },
    30_000,
  );

  it(
    "continues after a typed tool call and records the tool exchange",
    async () => {
      const running = await startHarness(await createDatabasePath());
       const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("tools", "check the workspace");
      const result = await client.wait(run);
      expect(result.text).toBe("Project Studio V2 workspace is ready.");

      const history = await client.history("tools");
      const parts = history.messages.flatMap((message) => message.parts);
      expect(
        parts.some(
          (part) =>
            part.type === "dynamic-tool" &&
            part.toolName === "workspace_summary" &&
            part.state === "output-available",
        ),
      ).toBe(true);
    },
    30_000,
  );

  it(
    "cancels accepted work with a durable aborted outcome",
    async () => {
      const running = await startHarness(await createDatabasePath());
       const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("cancel", "[slow] please wait");
      expect(await client.cancel("cancel")).toBe(true);
      await expect(client.wait(run)).rejects.toThrow();

      const history = await client.history("cancel");
      expect(
        history.settlements.find(
          (settlement) => settlement.submissionId === run.submissionId,
        )?.outcome,
      ).toBe("aborted");
    },
    30_000,
  );

  it(
    "settles a submission that the provider kept refusing as failed, in the provider own words",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // The test provider answers `[fail]` with a transient 429, every time.
      // Flue retries it a bounded number of times and then gives up, and what
      // it records must be a FAILURE carrying the reason — not a completed
      // turn that happens to be empty. A rate-limited turn rendering as a
      // silent success is the one failure mode reliability-and-the-silent-
      // stop.md calls unacceptable, so this pins the harness side of it.
      const run = await client.send("provider-failure", "[fail] please answer.");
      await expect(client.wait(run)).rejects.toThrow();

      const history = await client.history("provider-failure");
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("failed");
      expect(JSON.stringify(settlement)).toContain("rate limit");
    },
    90_000,
  );

  it(
    "fails fast on quota exhaustion instead of burning the retry budget",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // OpenAI reports exhausted billing as HTTP 429 — which the old inline
      // classifier retried three times before showing the person the one
      // sentence that could actually help. The patched policy refuses to
      // retry it at all: one attempt, straight to a visible failure.
      const run = await client.send(
        "quota",
        "[fail: You exceeded your current quota, please check your plan and billing details (insufficient_quota)] please answer.",
      );
      await expect(client.wait(run)).rejects.toThrow();

      const history = await client.history("quota");
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("failed");
      expect(JSON.stringify(settlement)).toContain("insufficient_quota");
      expect(attemptCount(history, "[fail: You exceeded your current quota")).toBe(1);
    },
    30_000,
  );

  it(
    "does not retry billing exhaustion that arrives dressed as a 429",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // The adversarial shape: a sentence matching BOTH lists at once. The
      // non-retryable guard runs first in pi-ai's classifier (and therefore in
      // the patched runtime), so the 429 must not win.
      const run = await client.send(
        "billing-429",
        "[fail: You exceeded your current quota, please check your plan and billing details (insufficient_quota). (HTTP 429)] please answer.",
      );
      await expect(client.wait(run)).rejects.toThrow();

      const history = await client.history("billing-429");
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("failed");
      expect(attemptCount(history, "[fail: You exceeded your current quota")).toBe(1);
    },
    30_000,
  );

  it(
    "retries transient wording the old classifier missed until the budget is spent",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // OpenRouter's wrapper sentence matched nothing in the old inline regex,
      // so this failure was never retried and lost its work on the first try.
      // The patched policy recognizes it; four assistant records on the wire
      // are the proof — first attempt plus the full retry budget.
      const run = await client.send("openrouter", "[fail: Provider returned error] please answer.");
      await expect(client.wait(run)).rejects.toThrow();

      const history = await client.history("openrouter");
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("failed");
      expect(attemptCount(history, "[fail: Provider returned error")).toBe(4);
    },
    90_000,
  );

  it(
    "recovers when a transient refusal clears on the second attempt",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // Retry must still WORK, not merely fail with better manners: one
      // refused attempt, then a normal answer on the retry, settling complete
      // — two attempts on the wire, exactly.
      const run = await client.send("retry-recovers", "[fail-once] please answer.");
      const result = await client.wait(run);
      expect(result.text).toContain("Echo:");

      const history = await client.history("retry-recovers");
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("completed");
      expect(attemptCount(history, "[fail-once]")).toBe(2);
    },
    30_000,
  );

  it(
    "leaves an unrecognized provider failure at one attempt rather than guessing",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // A sentence matching nothing stays unclassified: no retry, no invented
      // category — the settlement carries the provider's own words untouched.
      const run = await client.send(
        "unrecognized",
        "[fail: The upstream planet is misaligned] please answer.",
      );
      await expect(client.wait(run)).rejects.toThrow();

      const history = await client.history("unrecognized");
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("failed");
      expect(JSON.stringify(settlement)).toContain("The upstream planet is misaligned");
      expect(attemptCount(history, "[fail: The upstream planet")).toBe(1);
    },
    30_000,
  );

  it(
    "resumes an accepted submission after a Node process restart",
    async () => {
      const databasePath = await createDatabasePath();
      const firstServer = await startHarness(databasePath);
       const firstClient = new FlueHarnessClient({
         baseUrl: firstServer.baseUrl,
         token: firstServer.token,
       });
      const accepted: AcceptedRun = await firstClient.send(
        "restart",
        "[slow] survive restart",
      );

      await stopHarness(firstServer.process);

      const replacement = await startHarness(databasePath);
      const resumedRun = {
        ...accepted,
        streamUrl: `${replacement.baseUrl}/agents/studio/restart`,
      };
       const replacementClient = new FlueHarnessClient({
         baseUrl: replacement.baseUrl,
         token: replacement.token,
       });

      const result = await replacementClient.wait(resumedRun);
      expect(result.text).toBe("Echo: survive restart");
    },
    90_000,
  );

  it(
    "recovers after SIGKILL without duplicating the completed conversation",
    async () => {
      const databasePath = await createDatabasePath();
      const firstServer = await startHarness(databasePath);
      const firstClient = new FlueHarnessClient({
        baseUrl: firstServer.baseUrl,
        token: firstServer.token,
      });
      const accepted: AcceptedRun = await firstClient.send(
        "hard-restart",
        "[slow] survive hard restart",
      );

      // The admission response proves the submission is durable before the
      // process is removed without running its shutdown handlers.
      await killHarness(firstServer.process);

      const replacement = await startHarness(databasePath);
      const replacementClient = new FlueHarnessClient({
        baseUrl: replacement.baseUrl,
        token: replacement.token,
      });
      const resumedRun = {
        ...accepted,
        streamUrl: `${replacement.baseUrl}/agents/studio/hard-restart`,
      };

      expect((await replacementClient.wait(resumedRun)).text).toBe(
        "Echo: survive hard restart",
      );

      const history = await replacementClient.history("hard-restart");
      const rendered = history.messages.map(textFromMessage);
      expect(rendered.filter((text) => text === "Echo: survive hard restart")).toHaveLength(1);

      for (const path of [databasePath, join(dirname(databasePath), "studio.db")]) {
        const database = new DatabaseSync(path);
        try {
          expect(database.prepare("PRAGMA integrity_check").get()).toEqual({
            integrity_check: "ok",
          });
        } finally {
          database.close();
        }
      }
    },
    90_000,
  );

  it(
    "keeps Flue execution state separate from application state across a cold start",
    async () => {
      const databasePath = await createDatabasePath();
      const studioDatabasePath = join(dirname(databasePath), "studio.db");
      const firstServer = await startHarness(databasePath);
      const firstClient = new FlueHarnessClient({
        baseUrl: firstServer.baseUrl,
        token: firstServer.token,
      });

      await firstClient.wait(await firstClient.send("separation", "persist this"));
      await stopHarness(firstServer.process);

      const flueDatabase = new DatabaseSync(databasePath);
      const studioDatabase = new DatabaseSync(studioDatabasePath);
      try {
        const studioTables = studioDatabase
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>;
        const flueTables = flueDatabase
          .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
          .all() as Array<{ name: string }>;

        expect(studioTables.map((table) => table.name)).toContain("schema_migration");
        expect(studioTables.map((table) => table.name)).toContain("app_setting");
        expect(flueTables.map((table) => table.name)).not.toContain("schema_migration");
        expect(flueTables.map((table) => table.name)).not.toContain("app_setting");
      } finally {
        flueDatabase.close();
        studioDatabase.close();
      }

      const replacement = await startHarness(databasePath);
      const history = await new FlueHarnessClient({
        baseUrl: replacement.baseUrl,
        token: replacement.token,
      }).history("separation");
      expect(history.messages.map(textFromMessage)).toContain("persist this");
    },
    30_000,
  );

  /**
   * There is no admission idempotency, and this test says so out loud.
   *
   * It replaces one that asserted the opposite. That test passed — but only
   * because `@flue/sdk` and `@flue/runtime` were hand-diffed in `dist/`, the
   * same mechanism that once shipped a call to a function existing in no
   * release of beta.9 and made every submission return 500. Meta-task #12
   * deleted those patches, so the behaviour is now Flue's own: an identical
   * resend is a **second submission and a second turn**.
   *
   * This is a hazard record, not an endorsement. Pinning it matters in both
   * directions. If someone reintroduces deduplication, this test fails and the
   * change has to be argued rather than absorbed. And while it fails to
   * deduplicate, nothing may retry a send automatically — ADR 0033's rule that
   * a lost acknowledgement is `unknown` is the only thing standing between a
   * dropped response and a silently duplicated turn.
   */
  it(
    "does not deduplicate an identical resend — a lost ack stays unknown",
    async () => {
      const databasePath = await createDatabasePath();
      const running = await startHarness(databasePath);
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const first = await client.send("idempotent", "same request");
      await client.wait(first);
      const resend = await client.send("idempotent", "same request");
      await client.wait(resend);

      expect(resend.submissionId).not.toBe(first.submissionId);
      const history = await client.history("idempotent");
      expect(history.messages.filter((message) => message.role === "user")).toHaveLength(2);
    },
    60_000,
  );

  it(
    "does not rewrite Flue state when application database startup fails",
    async () => {
      const databasePath = await createDatabasePath();
      const studioDatabasePath = join(dirname(databasePath), "studio.db");
      const firstServer = await startHarness(databasePath);
      const firstClient = new FlueHarnessClient({
        baseUrl: firstServer.baseUrl,
        token: firstServer.token,
      });

      await firstClient.wait(await firstClient.send("failure-isolation", "keep this"));
      await stopHarness(firstServer.process);

      const validStudioDatabase = await readFile(studioDatabasePath);
      const corruptStudioDatabase = Buffer.from("not a SQLite database\n", "utf8");
      await writeFile(studioDatabasePath, corruptStudioDatabase);

      // The sidecars go too. A `-wal` left beside the corrupt file is not a
      // corrupt database: SQLite replays the log, rebuilds a valid header, and
      // opens normally — so leaving them made this assert the opposite of what
      // it reads as. Recovery from a hot WAL is correct behaviour; what this
      // test is about is a database that genuinely cannot be read.
      await rm(`${studioDatabasePath}-wal`, { force: true });
      await rm(`${studioDatabasePath}-shm`, { force: true });

      await expect(startHarness(databasePath)).rejects.toThrow(/exited during startup/i);
      expect(await readFile(studioDatabasePath)).toEqual(corruptStudioDatabase);

      await writeFile(studioDatabasePath, validStudioDatabase);
      const replacement = await startHarness(databasePath);
      const history = await new FlueHarnessClient({
        baseUrl: replacement.baseUrl,
        token: replacement.token,
      }).history("failure-isolation");
      expect(history.messages.map(textFromMessage)).toContain("keep this");
    },
    30_000,
  );

  it(
    "closes the application database cleanly on shutdown, leaving no hot WAL",
    async () => {
      // `SIGTERM` is not deliverable on Windows — it maps to TerminateProcess,
      // which ends the process without running a handler — so the shutdown
      // path never ran and every stop left a hot `-wal` behind. A checkpointed
      // database is the observable proof that shutdown actually happened.
      const databasePath = await createDatabasePath();
      const studioDatabasePath = join(dirname(databasePath), "studio.db");
      const server = await startHarness(databasePath);
      const client = new FlueHarnessClient({
        baseUrl: server.baseUrl,
        token: server.token,
      });
      await client.wait(await client.send("clean-shutdown", "write something"));

      await stopHarness(server.process);

      expect(existsSync(`${studioDatabasePath}-wal`)).toBe(false);
      expect(existsSync(`${studioDatabasePath}-shm`)).toBe(false);
    },
    30_000,
  );
});

describe("the startup silence window", () => {
  it("replaces a harness that produces no output and names both attempts in the failure", async () => {
    const databasePath = await createDatabasePath();
    // A deterministic stand-in for a machine-stalled boot: alive, listening on
    // nothing, writing not one byte to either pipe — the shape the full-suite
    // failures arrived in and the shape a slow-but-healthy boot never has.
    const entry = join(dirname(databasePath), "never-speaks.mjs");
    await writeFile(entry, "setInterval(() => {}, 1000);\n", "utf8");

    const failure: unknown = await startHarness(databasePath, {
      entry,
      startupBudgetMs: 3_000,
      startupSilenceMs: 600,
    }).then(
      () => undefined,
      (cause: unknown) => cause,
    );

    // Two distinct children were started on one shared budget: the first was
    // killed for staying silent, the second exhausted what remained. Without
    // the replacement this fails with a single pid and no history line.
    if (!(failure instanceof Error)) {
      throw new Error("startHarness resolved instead of failing.");
    }
    const pids = [...failure.message.matchAll(/pid=(\d+)/g)].map((match) => match[1]);
    expect(new Set(pids).size).toBe(2);
    expect(failure.message).toContain(
      "An earlier attempt was replaced for staying silent",
    );
    expect(failure.message).toContain("never accepted a connection");
  });
});
