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
        // The whole Studio home travels with the database: an agent turn now
        // creates its conversation tree under it, and a test must not write
        // there under the developer's real home.
        PROJECT_STUDIO_HOME: dirname(databasePath),
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
      text.length > 2_000 ? `...${text.slice(-2_000)}` : text;

    const baseUrl = `http://127.0.0.1:${port}`;
    /** Kept so the failure can say what the last attempt actually objected to. */
    let lastProbeError: unknown;
    // Undici's top-level sentence is "fetch failed" for a refused connection
    // and for a timed-out one alike; the difference is exactly what separates
    // a port race from a wedged child, so it is carried up from the cause.
    const probeSentence = (error: unknown): string => {
      if (!(error instanceof Error)) return String(error);
      const cause = error.cause;
      return cause instanceof Error
        ? `${error.message} (${cause.message})`
        : error.message;
    };
    const describeFailure = (): string =>
      [
        ` The harness on ${baseUrl} never accepted a connection.`,
        `pid=${String(child.pid)}`,
        `exitCode=${String(child.exitCode)}`,
        `signal=${String(child.signalCode)}`,
        // A port taken between allocation and use is the other way this fails,
        // and it looks nothing like a slow boot once the message says so.
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

/* ---- Reading the updates view over plain HTTP ---------------------------- */

/**
 * The retry signal the patched runtime appends, read structurally rather than
 * through `@flue/sdk`: its chunk validator refuses unknown types by design (a
 * protocol mismatch should fail loudly), which is exactly the behaviour these
 * tests must observe from the outside. Narrowing by hand keeps that honest.
 */
interface RetryWaitChunk {
  readonly type: unknown;
  readonly submissionId: unknown;
  // The predicate only accepts the chunk when all three read as numbers,
  // so carrying them as numbers is the check's verdict, not an assumption.
  readonly attempt: number;
  readonly maxRetries: number;
  readonly delayMs: number;
  readonly error: unknown;
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRetryWaitChunk(value: unknown): value is RetryWaitChunk {
  return (
    isRecordValue(value) &&
    value["type"] === "submission-retrying" &&
    typeof value["attempt"] === "number" &&
    typeof value["maxRetries"] === "number" &&
    typeof value["delayMs"] === "number"
  );
}

function isSettledChunk(value: unknown): value is Record<string, unknown> {
  return isRecordValue(value) && value["type"] === "submission-settled";
}

function updatesUrl(run: AcceptedRun, offset: string): URL {
  const url = new URL(run.streamUrl);
  url.searchParams.set("view", "updates");
  url.searchParams.set("offset", offset);
  return url;
}

/** One ordered read of every chunk the conversation ever projected. */
async function readUpdateChunks(running: RunningHarness, run: AcceptedRun): Promise<unknown[]> {
  const response = await fetch(updatesUrl(run, "-1"), {
    headers: { authorization: `Bearer ${running.token}` },
  });
  if (!response.ok) {
    throw new Error(`The updates view answered ${String(response.status)}.`);
  }
  const body: unknown = await response.json();
  if (!Array.isArray(body)) {
    throw new Error("The updates view did not answer an array of chunks.");
  }
  return body;
}

/**
 * Long-polls the updates view until the predicate holds — how a client waits
 * during a live run without the SDK's typed stream in the way. `startOffset`
 * is where the reader resumes from: the default reads the whole journal, and
 * a client reattaching mid-run passes the offset it saw last (ADR 0045).
 */
async function collectUntil(
  running: RunningHarness,
  run: AcceptedRun,
  predicate: (chunks: readonly unknown[]) => boolean,
  timeoutMs = 20_000,
  startOffset = "-1",
): Promise<readonly unknown[]> {
  const collected: unknown[] = [];
  let offset = startOffset;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const url = updatesUrl(run, offset);
    url.searchParams.set("live", "long-poll");
    const response = await fetch(url, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    if (!response.ok) {
      throw new Error(`The live updates view answered ${String(response.status)}.`);
    }
    const body: unknown = await response.json();
    if (Array.isArray(body)) collected.push(...body);
    const nextOffset = response.headers.get("Stream-Next-Offset");
    if (nextOffset !== null && nextOffset !== "") offset = nextOffset;
    if (predicate(collected)) return collected;
  }
  throw new Error(`No batch satisfied the collector within ${String(timeoutMs)}ms.`);
}

/**
 * Waits for the submission's settlement on the updates view. `@flue/sdk`'s
 * `wait` cannot be used here: its chunk validator refuses unknown types by
 * design, so a client built before the retry signal existed fails loudly
 * mid-turn — which is exactly the compatibility fact these tests exist to
 * observe from the outside.
 */
async function waitForSettledChunk(
  running: RunningHarness,
  run: AcceptedRun,
  timeoutMs: number,
): Promise<Record<string, unknown> | null> {
  const chunks = await collectUntil(
    running,
    run,
    (items) =>
      items.some((item) => isSettledChunk(item) && item["submissionId"] === run.submissionId),
    timeoutMs,
  );
  const settled = chunks
    .filter(isSettledChunk)
    .find((chunk) => chunk["submissionId"] === run.submissionId);
  return settled ?? null;
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
            part.toolName === "glob" &&
            part.state === "output-available",
        ),
      ).toBe(true);
    },
    30_000,
  );

  it(
    "runs two tool calls from one assistant message and records both",
    async () => {
      // Parallel tool calling, end to end. The model returns two calls in one
      // message; Flue dispatches them together; both land in Studio's own
      // gate as `native/glob`, are authorized separately, and come back as two
      // outcomes against the one assistant message.
      //
      // What this guards is the whole path rather than any one piece of it. A
      // regression anywhere along it - a dispatcher that only ever ran the
      // first call, a gate that could not be entered twice at once, a
      // transcript that recorded one outcome over the other - shows up here as
      // a missing tool part, and nowhere else until someone watches a model
      // silently skip half its work.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("parallel-tools", "parallel please");
      await client.wait(run);

      const history = await client.history("parallel-tools");
      const parts = history.messages.flatMap((message) => message.parts);
      // Narrowed in the condition rather than by a cast: `filter` does not
      // narrow a union, and the part type is a union of very different shapes.
      const globs: { id: string; state: string }[] = [];
      for (const part of parts) {
        if (part.type === "dynamic-tool" && part.toolName === "glob") {
          globs.push({ id: part.toolCallId, state: part.state });
        }
      }

      // Two calls, two distinct ids, both answered. Asserting the ids as well
      // as the count is what stops one call recorded twice from passing.
      expect(globs).toHaveLength(2);
      expect(globs.every((part) => part.state === "output-available")).toBe(true);
      expect(new Set(globs.map((part) => part.id)).size).toBe(2);
    },
    30_000,
  );

  it(
    "parks a permission question carrying the bare conversation id",
    async () => {
      // The wire shape the prompt filters on, pinned end to end.
      //
      // Under Flue 1.0 the scope's conversation id was `conversation:<id>`.
      // 2.0 made the agent instance id the conversation id and dropped the
      // prefix, and the webview went on filtering the pending list for the
      // prefixed form - so it matched nothing, the prompt never rendered, and
      // every run that needed an approval parked with nothing on screen. The
      // model looked like it had hung.
      //
      // Nothing failed loudly, because a filter that matches nothing looks
      // exactly like a queue that is empty. This test is the difference: it
      // reads the id off the wire rather than trusting either side's idea of
      // what shape it is.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // Not awaited: the run parks on the approval and only settles once the
      // question is answered, which is the state being inspected.
      void client.send("cnv_askperm", "askme please");

      let pending: unknown[] = [];
      for (let attempt = 0; attempt < 40 && pending.length === 0; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 250));
        const response = await fetch(`${running.baseUrl}/api/permissions/pending`, {
          headers: { Authorization: `Bearer ${running.token}` },
        });
        pending = (await response.json()) as unknown[];
      }

      expect(pending).toHaveLength(1);
      const first = pending[0] as { request: { scope: { conversationId: string } } };
      // Bare. A prefix reappearing here is a webview that stops showing
      // prompts, so the assertion is on the exact string rather than on a
      // "contains the id" that both shapes would satisfy.
      expect(first.request.scope.conversationId).toBe("cnv_askperm");
    },
    60_000,
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

      // The test provider answers this sentence with a transient 503 every
      // time. Flue retries it a bounded number of times and then gives up,
      // and what it records must be a FAILURE carrying the reason — not a
      // completed turn that happens to be empty. A throttled or failing turn
      // rendering as a silent success is the one failure mode reliability-
      // and-the-silent-stop.md calls unacceptable, so this pins the harness
      // side of it. The sentence names the 503 rather than using bare `[fail]`
      // because Task 30 gave the 429 class a generous budget of its own;
      // exhausting that budget here would spend minutes proving what the
      // dedicated per-class tests below measure directly.
      //
      // Settlement is awaited on the raw wire rather than through the SDK's
      // `wait`: its chunk validator refuses unknown types by design, and this
      // turn now emits the `submission-retrying` signal. Everything asserted
      // afterwards is unchanged, read back from history as before.
      const run = await client.send(
        "provider-failure",
        "[fail: 503 service unavailable] please answer.",
      );
      const settled = await waitForSettledChunk(running, run, 60_000);
      expect(settled?.["outcome"]).toBe("failed");

      const history = await client.history("provider-failure");
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("failed");
      expect(JSON.stringify(settlement)).toContain("503");
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

      // The table's zero row is enforced by pi-ai's classifier, which refuses
      // these sentences before the retry site is ever reached — so the wire
      // must carry not one retry signal: no scheduled wait, no budget spent.
      const chunks = await readUpdateChunks(running, run);
      expect(chunks.filter(isRetryWaitChunk)).toHaveLength(0);
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
      // are the proof — first attempt plus the full retry budget. Awaited on
      // the raw wire for the same reason as `provider-failure` above.
      const run = await client.send("openrouter", "[fail: Provider returned error] please answer.");
      const settled = await waitForSettledChunk(running, run, 60_000);
      expect(settled?.["outcome"]).toBe("failed");

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
      // — two attempts on the wire, exactly. The completed settlement is
      // awaited on the raw wire (the SDK's validator refuses the retry
      // signal), and the answer itself is read back from history below.
      const run = await client.send("retry-recovers", "[fail-once] please answer.");
      const settled = await waitForSettledChunk(running, run, 30_000);
      expect(settled?.["outcome"]).toBe("completed");

      const history = await client.history("retry-recovers");
      expect(
        history.messages.some(
          (message) => message.role === "assistant" && textFromMessage(message).includes("Echo:"),
        ),
      ).toBe(true);
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("completed");
      expect(attemptCount(history, "[fail-once]")).toBe(2);
    },
    30_000,
  );

  it(
    "announces every scheduled retry on the wire while the provider keeps refusing",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // Three server failures used to spend about fourteen seconds emitting
      // repeated empty message pairs, with the retries known only to the
      // server log. Now each scheduled retry is a record, so the wire carries
      // exactly one signal per retry and none for the exhausted branch —
      // giving up must never read as another wait about to happen. The 503
      // wording pins the generic-transient budget of three; bare `[fail]`
      // would now name the rate-limit class, whose generous budget has its
      // own tests below.
      const run = await client.send(
        "retry-visible",
        "[fail: 503 service unavailable] please answer.",
      );
      await waitForSettledChunk(running, run, 60_000);

      const chunks = await readUpdateChunks(running, run);
      const retries = chunks.filter(isRetryWaitChunk);
      // Count what you assert: one signal per scheduled retry, not "some".
      expect(retries).toHaveLength(3);
      expect(retries.map((chunk) => chunk.attempt)).toEqual([1, 2, 3]);
      expect(retries.map((chunk) => chunk.maxRetries)).toEqual([3, 3, 3]);
      // The wait grows with the attempt — the existing exponential shape,
      // visible as facts rather than inferred from silence.
      const [first, second, third] = retries;
      if (first === undefined || second === undefined || third === undefined) {
        throw new Error("Three retry signals were counted but not delivered.");
      }
      expect(first.delayMs).toBeGreaterThan(0);
      expect(second.delayMs).toBeGreaterThan(first.delayMs);
      expect(third.delayMs).toBeGreaterThan(second.delayMs);
      for (const chunk of retries) {
        // The provider's sentence for the attempt that failed, and the
        // association with the submission the retry serves.
        expect(typeof chunk.error).toBe("string");
        expect(chunk.error).toContain("503");
        expect(chunk.submissionId).toBe(run.submissionId);
      }

      let lastRetryIndex = -1;
      let settledIndex = -1;
      chunks.forEach((chunk, index) => {
        if (isRetryWaitChunk(chunk)) lastRetryIndex = index;
        if (settledIndex === -1 && isSettledChunk(chunk)) settledIndex = index;
      });
      expect(settledIndex).toBeGreaterThan(-1);
      expect(lastRetryIndex).toBeLessThan(settledIndex);
      const settlement = chunks.filter(isSettledChunk)[0];
      if (settlement === undefined) throw new Error("No settled chunk followed the retries.");
      expect(settlement["outcome"]).toBe("failed");
    },
    90_000,
  );

  it(
    "announces exactly one retry when the refusal clears, then completes cleanly",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // The case that must show a retry AND a recovery: one refused attempt,
      // one signal, then an ordinary answer. A finished turn carrying a stale
      // "retrying" state would be the same fabrication class as a fabricated
      // success, so the completed settlement has to come after the signal.
      const run = await client.send("recover-visible", "[fail-once] please answer.");
      const settlement = await waitForSettledChunk(running, run, 30_000);
      expect(settlement?.["outcome"]).toBe("completed");

      const chunks = await readUpdateChunks(running, run);
      const retries = chunks.filter(isRetryWaitChunk);
      expect(retries).toHaveLength(1);
      const [only] = retries;
      if (only === undefined) throw new Error("The retry signal vanished between filter and read.");
      expect(only.attempt).toBe(1);
      expect(only.submissionId).toBe(run.submissionId);

      let lastRetryIndex = -1;
      let completedIndex = -1;
      chunks.forEach((chunk, index) => {
        if (isRetryWaitChunk(chunk)) lastRetryIndex = index;
        if (
          completedIndex === -1 &&
          isSettledChunk(chunk) &&
          chunk["submissionId"] === run.submissionId &&
          chunk["outcome"] === "completed"
        ) {
          completedIndex = index;
        }
      });
      expect(completedIndex).toBeGreaterThan(lastRetryIndex);
    },
    30_000,
  );

  it(
    "ends a cancelled retry visibly rather than letting it simply stop",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("cancel-retry", "[fail] please answer.");
      // Cancel DURING a retry wait: the sleep is abortable, and the person
      // cancelling mid-wait must get a visible ending, not silence. Bare
      // `[fail]` names the rate-limit class under the per-class budgets, so
      // the first signal doubles as the cheapest look at its generous budget
      // on the wire — eight retries where three shipped, read off the chunk
      // instead of waiting the run out.
      const firstSignal = await collectUntil(
        running,
        run,
        (chunks) => chunks.some(isRetryWaitChunk),
      ).then((chunks) => chunks.find(isRetryWaitChunk));
      expect(firstSignal?.maxRetries).toBe(8);
      await client.cancel("cancel-retry");
      const settlement = await waitForSettledChunk(running, run, 30_000);
      expect(settlement?.["outcome"]).toBe("aborted");

      // Whichever point the cancellation reached — inside the sleep, or an
      // attempt after it — the aborted settlement follows every retry signal
      // and nothing retry-shaped comes after it.
      const chunks = await readUpdateChunks(running, run);
      let lastRetryIndex = -1;
      let abortedIndex = -1;
      chunks.forEach((chunk, index) => {
        if (isRetryWaitChunk(chunk)) lastRetryIndex = index;
        if (
          abortedIndex === -1 &&
          isSettledChunk(chunk) &&
          chunk["submissionId"] === run.submissionId &&
          chunk["outcome"] === "aborted"
        ) {
          abortedIndex = index;
        }
      });
      expect(abortedIndex).toBeGreaterThan(-1);
      expect(lastRetryIndex).toBeLessThan(abortedIndex);
      const retriesAfterAbort = chunks.filter(
        (chunk, index) => isRetryWaitChunk(chunk) && index > abortedIndex,
      );
      expect(retriesAfterAbort).toHaveLength(0);
    },
    60_000,
  );

  it(
    "follows the class when the failure changes between attempts",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // The adversarial shape for a per-class budget: attempt one fails with
      // a 503 (generic-transient, budget three), attempt two with a 429
      // (rate-limit, budget eight). Each decision reads the failure actually
      // in front of the loop — no memory, no averaging across classes — so
      // the second signal must carry the generous budget even though the run
      // began as server trouble.
      const run = await client.send(
        "class-change",
        "[fail-seq: 503 service unavailable | 429 too many requests] please answer.",
      );
      const settlement = await waitForSettledChunk(running, run, 30_000);
      expect(settlement?.["outcome"]).toBe("completed");

      const chunks = await readUpdateChunks(running, run);
      const retries = chunks.filter(isRetryWaitChunk);
      expect(retries.map((chunk) => chunk.attempt)).toEqual([1, 2]);
      expect(retries.map((chunk) => chunk.maxRetries)).toEqual([3, 8]);
      // Each signal carries the sentence of the failure that earned it.
      // Read as a string only when it is one: `String()` on an object would
      // have compared "[object Object]" and reported a mismatch as a missing
      // status code.
      const reasons = retries.map((chunk) =>
        typeof chunk.error === "string" ? chunk.error : "",
      );
      expect(reasons[0]).toContain("503");
      expect(reasons[1]).toContain("429");
    },
    30_000,
  );

  it(
    "spends a transport failure's short budget and gives up announcing nothing further",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // A dead connection gets two retries, not three: if the network is
      // gone, waiting does not help. Three refusals drive one attempt past
      // that budget — the third must schedule nothing and settle failed,
      // proving the exhausted branch still emits nothing under per-class
      // budgets.
      const run = await client.send(
        "transport-exhausted",
        "[fail-seq: socket hang up | socket hang up | socket hang up] please answer.",
      );
      const settled = await waitForSettledChunk(running, run, 30_000);
      expect(settled?.["outcome"]).toBe("failed");

      const history = await client.history("transport-exhausted");
      const settlement = history.settlements.find(
        (candidate) => candidate.submissionId === run.submissionId,
      );
      expect(settlement?.outcome).toBe("failed");
      expect(JSON.stringify(settlement)).toContain("socket hang up");
      expect(attemptCount(history, "[fail-seq: socket hang up")).toBe(3);

      const chunks = await readUpdateChunks(running, run);
      const retries = chunks.filter(isRetryWaitChunk);
      expect(retries.map((chunk) => chunk.attempt)).toEqual([1, 2]);
      expect(retries.map((chunk) => chunk.maxRetries)).toEqual([2, 2]);
    },
    30_000,
  );

  it(
    "grants the final retry at exactly the transport budget boundary",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // Two failures against a budget of two: the second decision sits ON
      // the boundary and must still be granted — give-up begins only once
      // the count EXCEEDS the budget, the same asymmetry the single number
      // always had.
      const run = await client.send(
        "transport-boundary",
        "[fail-seq: socket hang up | socket hang up] please answer.",
      );
      const settlement = await waitForSettledChunk(running, run, 30_000);
      expect(settlement?.["outcome"]).toBe("completed");

      const history = await client.history("transport-boundary");
      expect(attemptCount(history, "[fail-seq: socket hang up")).toBe(3);

      const chunks = await readUpdateChunks(running, run);
      const retries = chunks.filter(isRetryWaitChunk);
      expect(retries.map((chunk) => chunk.attempt)).toEqual([1, 2]);
      expect(retries.map((chunk) => chunk.maxRetries)).toEqual([2, 2]);
    },
    30_000,
  );

  it(
    "keeps a rate-limited turn going past the old budget and cancels a long wait cleanly",
    async () => {
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // The permission Task 29 bought, spent: eight retries of doubling from
      // two seconds is minutes of waiting, defensible only because every
      // second of it is announced and cancellable. Six signals in — past
      // anything the old single budget allowed — the person cancels: the
      // wait ends visibly, nothing retry-shaped follows, and every signal
      // carried the generous budget rather than a silent fallback to three.
      const run = await client.send("generous-cancel", "[fail] please answer.");
      const collected = await collectUntil(
        running,
        run,
        (chunks) => chunks.filter(isRetryWaitChunk).length >= 6,
        130_000,
      );
      const retries = collected.filter(isRetryWaitChunk);
      expect(retries.map((chunk) => chunk.attempt)).toEqual([1, 2, 3, 4, 5, 6]);
      for (const chunk of retries) {
        expect(chunk.maxRetries).toBe(8);
      }

      await client.cancel("generous-cancel");
      const settlement = await waitForSettledChunk(running, run, 30_000);
      expect(settlement?.["outcome"]).toBe("aborted");

      const chunks = await readUpdateChunks(running, run);
      let lastRetryIndex = -1;
      let abortedIndex = -1;
      chunks.forEach((chunk, index) => {
        if (isRetryWaitChunk(chunk)) lastRetryIndex = index;
        if (
          abortedIndex === -1 &&
          isSettledChunk(chunk) &&
          chunk["submissionId"] === run.submissionId &&
          chunk["outcome"] === "aborted"
        ) {
          abortedIndex = index;
        }
      });
      expect(abortedIndex).toBeGreaterThan(-1);
      expect(lastRetryIndex).toBeLessThan(abortedIndex);
      const retriesAfterAbort = chunks.filter(
        (chunk, index) => isRetryWaitChunk(chunk) && index > abortedIndex,
      );
      expect(retriesAfterAbort).toHaveLength(0);
    },
    170_000,
  );

  it(
    "re-derives the attempt count across a restart instead of starting over",
    async () => {
      const databasePath = await createDatabasePath();
      const firstServer = await startHarness(databasePath);
      const firstClient = new FlueHarnessClient({
        baseUrl: firstServer.baseUrl,
        token: firstServer.token,
      });

      // Two server failures are announced, and the turn is killed inside the
      // SECOND wait. The replacement server resumes the same submission by
      // re-entering the retry decision, counting the two errored records it
      // finds persisted, and announcing attempt 2 again — the duplicate is
      // not a reset counter losing its place, it is the same number derived
      // twice from records, which is the whole property. The generic budget
      // is three, so the resumed turn holds ONE grant left, not three: the
      // fourth refusal exhausts it into a visible failure. A counter that
      // had restarted would have completed the turn instead — a fresh budget
      // wearing resume's clothes is exactly the fabrication class this rule
      // exists to prevent.
      const accepted = await firstClient.send(
        "resume-retry-count",
        "[fail-seq: 503 service unavailable | 503 service unavailable | 503 service unavailable | 503 service unavailable] survive this.",
      );
      await collectUntil(firstServer, accepted, (chunks) => {
        return chunks.filter(isRetryWaitChunk).length >= 2;
      });

      await killHarness(firstServer.process);

      const replacement = await startHarness(databasePath);
      const resumedRun = {
        ...accepted,
        streamUrl: `${replacement.baseUrl}/agents/studio/resume-retry-count`,
      };
      const replacementClient = new FlueHarnessClient({
        baseUrl: replacement.baseUrl,
        token: replacement.token,
      });
      const settled = await waitForSettledChunk(replacement, resumedRun, 90_000);
      expect(settled?.["outcome"]).toBe("failed");

      // [1, 2] came from the first process; [2, 3] from the replacement. No
      // signal follows attempt 3: the exhausted branch announces nothing.
      const chunks = await readUpdateChunks(replacement, resumedRun);
      const retries = chunks.filter(isRetryWaitChunk);
      expect(retries.map((chunk) => chunk.attempt)).toEqual([1, 2, 2, 3]);
      expect(retries.map((chunk) => chunk.maxRetries)).toEqual([3, 3, 3, 3]);

      let lastRetryIndex = -1;
      let failedIndex = -1;
      chunks.forEach((chunk, index) => {
        if (isRetryWaitChunk(chunk)) lastRetryIndex = index;
        if (
          failedIndex === -1 &&
          isSettledChunk(chunk) &&
          chunk["submissionId"] === accepted.submissionId &&
          chunk["outcome"] === "failed"
        ) {
          failedIndex = index;
        }
      });
      expect(failedIndex).toBeGreaterThan(-1);
      expect(lastRetryIndex).toBeLessThan(failedIndex);

      // Four refused attempts on the wire, and nothing beyond them.
      const history = await replacementClient.history("resume-retry-count");
      expect(attemptCount(history, "[fail-seq: 503")).toBe(4);
    },
    120_000,
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
    "feeds two live readers at different offsets without one consuming from the other",
    async () => {
      // ADR 0045 §Decision: the conversation stream is a durable journal with
      // opaque offsets, so two readers at two offsets was always in scope.
      // This is the first time it has actually been done. Two windows - or,
      // since the listener, two devices - read one conversation at once: the
      // second one attaching mid-run from the offset a first read handed it.
      // The property the durable read promises is that reading does not
      // consume: both readers see the same events, each from its own offset,
      // and neither's progress moves the other's.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // A turn still running while both readers attach. The first read takes
      // the journal's early chunks and comes back with the offset to resume
      // from - exactly what a second device's first read does.
      const run = await client.send("two-readers", "[slow] read me twice");
      // The premise is a journal with early chunks in it when the second
      // reader attaches. Under a loaded suite the first read can land before
      // the turn has written anything, and an offset taken then is the start
      // - both readers would then see the same events and the property under
      // test would be untested. So the first read repeats until the journal
      // has something to hand over.
      let midRunOffset = "";
      for (let attempt = 0; attempt < 50 && midRunOffset === ""; attempt += 1) {
        const firstRead = await fetch(updatesUrl(run, "-1"), {
          headers: { authorization: `Bearer ${running.token}` },
        });
        if (!firstRead.ok) {
          throw new Error(`The first read answered ${String(firstRead.status)}.`);
        }
        const chunks: unknown = await firstRead.json();
        if (Array.isArray(chunks) && chunks.length > 0) {
          midRunOffset = firstRead.headers.get("Stream-Next-Offset") ?? "";
        }
        if (midRunOffset === "") await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(midRunOffset).not.toBe("");

      const settledHere = (chunks: readonly unknown[]): boolean =>
        chunks.some(
          (chunk) => isSettledChunk(chunk) && chunk["submissionId"] === run.submissionId,
        );

      const [fromStart, fromMidRun] = await Promise.all([
        collectUntil(running, run, settledHere),
        collectUntil(running, run, settledHere, 20_000, midRunOffset),
      ]);

      // Both readers were fed the settlement, live, from their own offsets.
      // Narrowed after the find rather than by a cast: the predicate's type
      // guard cannot flow through a `find` that also compares fields.
      const settledForThisRun = (chunks: readonly unknown[]): Record<string, unknown> | undefined => {
        const found = chunks.find(
          (chunk) => isSettledChunk(chunk) && chunk["submissionId"] === run.submissionId,
        );
        return isSettledChunk(found) ? found : undefined;
      };
      const firstSettled = settledForThisRun(fromStart);
      const midSettled = settledForThisRun(fromMidRun);
      expect(firstSettled).toBeDefined();
      expect(midSettled).toBeDefined();

      // The mid-run reader started later and missed the early chunks - the
      // offsets are honoured, not normalized back to the beginning.
      expect(fromStart.length).toBeGreaterThan(fromMidRun.length);

      // And what the mid-run reader saw, event for event, is what the
      // from-the-start reader saw from the same point on: one journal, two
      // readers, no interference. The deliveries are not compared raw,
      // because the view frames each live read with reader-relative markers -
      // a `conversation-reset` carrying the snapshot at attach, and a
      // `stream-checkpoint` stamped with the reader's own incarnation - which
      // are the framing of a read, not events of the conversation.
      const isReaderFraming = (chunk: unknown): boolean =>
        isRecordValue(chunk) &&
        (chunk["type"] === "conversation-reset" || chunk["type"] === "stream-checkpoint");
      const substantiveStart = fromStart.filter((chunk) => !isReaderFraming(chunk));
      const substantiveMidRun = fromMidRun.filter((chunk) => !isReaderFraming(chunk));
      expect(substantiveStart.slice(-substantiveMidRun.length)).toEqual(substantiveMidRun);
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

  /* ---------------------------------------------------------------------- */
  /* The model the user actually picked (Task 38)                            */
  /* ---------------------------------------------------------------------- */

  /**
   * Submits with a turn's settings, the way the webview does: the settings
   * ride the submission body, and Flue itself strips everything but the
   * delivered message from the payload it stores. Under 2.0 the delivered
   * message is an envelope - `{ kind: "user", body }` - so the settings are
   * sent beside it, at the top level, exactly where the turn-settings
   * middleware reads them before Flue parses the payload. Everything the
   * settings then do happens at our admission boundary, so the receipt alone
   * tells whether the write landed first.
   */
  async function submitWithSettings(
    running: RunningHarness,
    conversationId: string,
    settings: Record<string, unknown>,
  ): Promise<Response> {
    return fetch(`${running.baseUrl}/agents/studio/${conversationId}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${running.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        kind: "user",
        body: "please answer",
        ...settings,
      }),
    });
  }

  interface IndexRecord {
    readonly id: unknown;
    readonly modelId: unknown;
    readonly reasoningLevel: unknown;
  }

  async function conversationIndex(running: RunningHarness): Promise<IndexRecord[]> {
    const response = await fetch(`${running.baseUrl}/api/conversations`, {
      headers: { authorization: `Bearer ${running.token}` },
    });
    if (!response.ok) {
      throw new Error(`The conversation index answered ${String(response.status)}.`);
    }
    return (await response.json()) as IndexRecord[];
  }

  /**
   * The model info the assistant history records carried, read narrowly.
   *
   * Kept as a scanner for what 2.0 no longer sends: under Flue 2.0 the
   * history projection's assistant records are
   * `{ id, role, purpose, display, submissionId, turnId, parts }` - there is
   * no `metadata` and no model identity on the message at all. 1.0's
   * `metadata.model` channel is gone, so "the history names the model it ran
   * on" is not an assertion this view can carry any more; the run-side
   * identification lives in the telemetry events, and Phase 7 verifies those
   * against real traces. The function stays so the absence is asserted
   * rather than assumed.
   */
  function modelRefs(history: unknown): string[] {
    if (!isRecordValue(history) || !Array.isArray(history["messages"])) return [];
    const names: string[] = [];
    for (const message of history["messages"]) {
      if (!isRecordValue(message) || message["role"] !== "assistant") continue;
      const metadata = message["metadata"];
      if (!isRecordValue(metadata)) continue;
      const model = metadata["model"];
      if (!isRecordValue(model)) continue;
      if (typeof model["id"] === "string") names.push(model["id"]);
    }
    return names;
  }

  it(
    "settles a submission's model and reasoning before the run reads them",
    async () => {
      const running = await startHarness(await createDatabasePath());

      // One connection, so the served-reference check has a real list to
      // answer from - the same list a picker is filled from.
      const openrouter = {
        id: "openrouter",
        displayName: "OpenRouter",
        serves: { language: "openai-completions" },
        source: "local",
        enabled: true,
        catalogProvider: "openrouter",
      };
      const created = await fetch(`${running.baseUrl}/api/providers/connections`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${running.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(openrouter),
      });
      if (!created.ok) {
        throw new Error(`The connection create answered ${String(created.status)}.`);
      }

      const models = (await (
        await fetch(`${running.baseUrl}/api/providers/models`, {
          headers: { authorization: `Bearer ${running.token}` },
        })
      ).json()) as Array<{ modelId: string; capability: { reasoning: string } }>;
      const reasoningModel = models.find((model) => model.capability.reasoning === "supported");
      if (reasoningModel === undefined) {
        throw new Error("The live catalog answered no reasoning model.");
      }

      const conversationId = "picked-model";
      // A FIRST turn: the index row does not exist yet, so the only way the
      // run can take the chosen model is for admission to settle it first.
      const submission = await submitWithSettings(running, conversationId, {
        modelId: `openrouter/${reasoningModel.modelId}`,
        reasoningLevel: "high",
      });
      expect(submission.status).toBe(202);

      const rows = await conversationIndex(running);
      const row = rows.find((entry) => entry.id === conversationId);
      expect(row?.modelId).toBe(`openrouter/${reasoningModel.modelId}`);
      expect(row?.reasoningLevel).toBe("high");

      // And the turn that was admitted answers as a completed run of that
      // conversation. 2.0's history projection carries no model identity on
      // assistant messages (see `modelRefs`), so the run-side half of "the
      // person's choice was used" is pinned by the settled settings above -
      // which are the only thing the run can read its model from - and the
      // identification itself moves to the telemetry events Phase 7 verifies.
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      const run: AcceptedRun = {
        threadId: conversationId,
        submissionId: String((await submission.json())["submissionId"]),
        streamUrl: `${running.baseUrl}/agents/studio/${conversationId}`,
        offset: "-1",
      };
      await client.wait(run);
      const history: unknown = await client.history(conversationId);
      expect(modelRefs(history)).toEqual([]);
    },
    30_000,
  );

  it(
    "refuses a submission whose model nothing serves, creating nothing",
    async () => {
      const running = await startHarness(await createDatabasePath());

      const submission = await submitWithSettings(running, "cnv_refused", {
        modelId: "openrouter/definitely/not-a-model",
      });

      expect(submission.status).toBe(400);
      const body: unknown = await submission.json();
      expect(
        isRecordValue(body) && typeof body["error"] === "string" ? body["error"] : "",
      ).toContain("No connected provider currently serves");
      // A send the harness refuses creates no row, no sidebar entry.
      expect(await conversationIndex(running)).toEqual([]);
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
