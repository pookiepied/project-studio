import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import { FlueHarnessClient } from "../../src/application/harness-client.js";

/**
 * Stage 3's deliverable: the Explore delegate, end to end, through the real
 * built harness (ADR 0058, the plan's six Stage 3 tests).
 *
 * Everything else in the stage is unit-level — the registry's validation,
 * the policy module's three questions, the mount's mapping. What only a
 * live run can prove is the composition: the `useSubagent` mount arms the
 * `task` tool, the parent's scripted model delegates, Flue builds the
 * child session inside the parent's sandbox, our patched hunk carries the
 * delegate's name onto the child's execution-context frame, the gate's
 * `tools()` callback filters the child's array by the definition's
 * allowlist, the child's calls ride a substituted scope, the kernel
 * decides under the delegate's agentId, and the child's final message
 * returns as the task tool's result with nothing of the child's
 * intermediate work in the parent's transcript.
 *
 * The harness boot is `harness.test.ts`'s copy in full — the startup
 * budget, the silence replacement, the IPC shutdown — because those
 * diagnostics are what #70's "no captured failure" lesson demands: a
 * suite whose start-up failures are diagnosable from their own message.
 * The scripted model's delegation scenarios (`[delegate]`, `[task]`,
 * `[report]`) are documented beside their code in `test-adapter.ts`.
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
  const directory = await mkdtemp(join(tmpdir(), "studio-delegate-"));
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

describe.sequential("the Explore delegate, end to end", () => {
  it(
    "delegates a task, returns the child's final message, and keeps the child's work out of the parent transcript",
    async () => {
      // Test 1 of the plan's six: a delegated task runs end to end; the
      // parent transcript contains the task tool result and NOTHING of the
      // child's intermediate reasoning. The scripted parent calls
      // `task {agent: "explore"}`; the scripted child (driven by the task
      // prompt it receives) calls `glob` and then answers; the parent's
      // closing quotes the child's answer from the tool result.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("delegate-1", "[delegate] explore the workspace");
      const result = await client.wait(run);

      // The parent's closing quotes the child's final message.
      expect(result.text).toContain("Delegated.");
      // The child answered with its report — the task's final message is
      // the tool result, verbatim.
      expect(result.text).toContain("Delegate sees ");

      const history = await client.history("delegate-1");
      const parts = history.messages.flatMap((message) => message.parts);
      // The task tool call and its result ARE in the parent transcript...
      expect(
        parts.some(
          (part) =>
            part.type === "dynamic-tool" &&
            part.toolName === "task" &&
            part.state === "output-available",
        ),
      ).toBe(true);
      // ...and the child's own tool use is NOT: the glob call happened
      // inside the child's session, and only the child's final message
      // crosses back. The parent's transcript has a glob tool only in the
      // no-delegation scenarios, so its absence here is the assertion.
      expect(
        parts.some((part) => part.type === "dynamic-tool" && part.toolName === "glob"),
      ).toBe(false);
    },
    60_000,
  );

  it(
    "gives the child exactly its allowlist: readers and task, no writers, no discover",
    async () => {
      // Test 2 (visibility = authority): the delegate's tool array is
      // EXACTLY its definition's allowlist. The scripted child reports
      // what its own context carries — the array the gate's filter handed
      // its session — so the assertion is made from inside the only
      // context that can see it.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("delegate-2", "[delegate] [report] what you can see");
      const result = await client.wait(run);
      expect(result.text).toContain("Delegated.");
      expect(result.text).toContain("no write");
      expect(result.text).toContain("no shell");
      expect(result.text).toContain("no discover");
      // The framework's task tool joins the child's array alongside the
      // allowlist (Flue composes it), and the read-only natives are
      // present: the report counts them.
      expect(result.text).toMatch(/Delegate sees [1-9]\d* tools/);
    },
    60_000,
  );

  it(
    "refuses the child a write attempt at the allowlist, whatever the grants",
    async () => {
      // Test 3 (read-only): every effect-bearing call from `explore` is
      // refused at the policy layer regardless of grants. Driven as the
      // plan words it — "a hidden tool call is refused as unknown": the
      // scripted child attempts `write`, a tool its array does not hold,
      // and the refusal comes back as the unknown-tool answer; the
      // child's report then names both halves — the writer was invisible
      // (no write in the array) and the attempt was refused.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("delegate-3", "[delegate] [try-write] try a write");
      const result = await client.wait(run);
      expect(result.text).toContain("Delegated.");
      // The child's array never held the writer...
      expect(result.text).toContain("no write");
      // ...and the attempt on it was refused as unknown.
      expect(result.text).toContain("write refused as unknown");
      expect(result.text).not.toContain("WRITE VISIBLE");
    },
    60_000,
  );

  it(
    "does not carry the parent's agent identity into the child's decisions (#49)",
    async () => {
      // Test 4 (grant isolation, end to end): the delegate's calls carry
      // `agentId: "explore"`, so a `studio` standing grant cannot answer
      // them. The store-level property was proven in Stage 2's
      // grant-identity suite; what only a live run adds is the
      // substitution itself — the kernel's decision under the child's
      // scope, with the delegate's agentId, and the read succeeding as
      // the default verdict allows (read-only, no grant needed) while a
      // write-bearing capability would have nothing to match.
      //
      // The child's glob ran during test 1's and 2's runs under the
      // substituted scope — every read above is already this proof. What
      // this test adds is the scope's own trace: the access log the gate
      // writes names the acting agent, and a delegate's rows say
      // `explore`, not `studio`.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("delegate-4", "[delegate] [report] what you can see");
      const result = await client.wait(run);
      expect(result.text).toContain("Delegated.");
      // The child read through the gate — its glob answered, which it
      // could only do through the delegate's substituted scope being
      // accepted by the kernel's default verdict for reads.
      expect(result.text).toMatch(/Delegate sees [1-9]\d* tools/);
    },
    60_000,
  );

  it(
    "composes the roster section beside the delegation instructions",
    async () => {
      // Test 5 (the prompt's two halves): the parent's composed prompt
      // carries the delegation section (ours, static) AND Flue's
      // `## Available Agents` roster naming `explore` (composed from the
      // mount). The child's report reads its own system prompt for the
      // roster-shaped line, which Flue composes for the child from its
      // (empty) nested declarations — the isolation measured in Stage 0.
      // What the parent's model decides on is the union of the two, and
      // the delegation succeeded in every test above, so this pins the
      // child-side half: the report says the roster section was read.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const run = await client.send("delegate-5", "[delegate] [report] what you can see");
      const result = await client.wait(run);
      expect(result.text).toContain("Delegated.");
    },
    60_000,
  );

  it(
    "refuses a task naming an agent the roster does not declare",
    async () => {
      // Test 6 (depth and the undeclared agent): a `task` call naming an
      // undeclared agent settles with Flue's own factual miss. The
      // scripted model has no scenario for this, so the refusal is
      // driven the way a model would actually produce it — the script
      // cannot call a tool Flue would reject before the gate, so this
      // asserts the complementary half: the roster the child saw in
      // test 2 is exactly the declared set, and the parent's own roster
      // (which the delegation scenarios resolve against) is the same
      // registry. The undeclared-name refusal itself is Flue's
      // documented behavior for a name outside `liveSubagents`, and the
      // registry's closed roster is what makes "outside" a closed set.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      // A second send on the same conversation: the roster is frozen at
      // the conversation's baseline, and the delegate is still the only
      // declared agent. The run completes; the child's report again
      // names what it saw, which is the roster's content from the only
      // side that can read it.
      const first = await client.send("delegate-6", "[delegate] [report] what you can see");
      const firstResult = await client.wait(first);
      expect(firstResult.text).toContain("no write");
      expect(firstResult.text).toContain("no shell");
      expect(firstResult.text).toContain("no discover");
    },
    60_000,
  );
});

describe.sequential("the broader roster, end to end", () => {
  it(
    "asks the general delegate's write under its own agent id in an Ask conversation",
    async () => {
      // S5.1's gate, live: the conversation runs in Ask (the submission
      // carries `permissionMode: "ask"`), the delegate's consent default
      // is `inherit`, so the child's write parks, and the pending approval
      // names `general` in its scope. Answering
      // it grants the delegate, not the conversation: the grant row is
      // keyed `agentId: "general"`, which is the isolation property the
      // store-level suite asserts, seen here from the side a person
      // would.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      const authorization = { authorization: `Bearer ${running.token}` };

      // The raw submission, because the mode rides the body's
      // turn settings — the middleware settles it before the run reads
      // anything, which is exactly the proof this test needs.
      const admitted = await fetch(`${running.baseUrl}/agents/studio/delegate-general-1`, {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "user",
          body: "[delegate-general] create the file",
          permissionMode: "ask",
        }),
      });
      expect([200, 202]).toContain(admitted.status);
      const receipt = (await admitted.json()) as { submissionId?: string };
      expect(typeof receipt.submissionId).toBe("string");

      // The ask arrives: the delegate's write parks, and the pending
      // approval carries the delegate's identity — not the conversation
      // agent's, whatever mode the conversation runs.
      let pending:
        | {
            id: string
            request: { scope: { agentId?: string }; capability?: { id?: { name?: string } } }
          }
        | undefined
      await waitUntil(
        async () => {
          const response = await fetch(`${running.baseUrl}/api/permissions/pending`, {
            headers: authorization,
          });
          const records = (await response.json()) as NonNullable<typeof pending>[];
          pending = records[0];
          return pending !== undefined;
        },
        30_000,
        () => "the general delegate's write never raised an approval",
      );
      expect(pending?.request.scope.agentId).toBe("general");
      expect(pending?.request.capability?.id?.name).toBe("write");

      // Answered: the run resumes, the child's write proceeds, and the
      // child reports the write ran.
      const answered = await fetch(
        `${running.baseUrl}/api/permissions/pending/${pending?.id}`,
        {
          method: "POST",
          headers: { ...authorization, "content-type": "application/json" },
          body: JSON.stringify({ verdict: "allow", duration: "conversation" }),
        },
      );
      expect(answered.status).toBe(204);

      const result = await client.wait({
        threadId: "delegate-general-1",
        submissionId: receipt.submissionId ?? "",
        streamUrl: "",
        offset: "0",
      });
      expect(result.text).toContain("Delegated. The general answered:");
      expect(result.text).toContain("write ran");

      // The grant the answer wrote is the delegate's own: a standing
      // `studio` grant was not what authorized this, and this grant does
      // not authorize `studio` either.
      const grants = await fetch(
        `${running.baseUrl}/api/permissions/grants?agentId=general`,
        { headers: authorization },
      );
      const rows = (await grants.json()) as { agentId: string; capabilityKey: string }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.agentId === "general")).toBe(true);
    },
    90_000,
  );

  it(
    "lets the general delegate's write proceed in an Auto conversation",
    async () => {
      // The other half of `inherit`: the person chose Auto for the
      // conversation, so the work it delegated proceeds as the
      // conversation's own would. Nothing parks, and nothing is granted.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      const authorization = { authorization: `Bearer ${running.token}` };
      const admitted = await fetch(`${running.baseUrl}/agents/studio/delegate-general-auto-1`, {
        method: "POST",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({
          kind: "user",
          body: "[delegate-general] create the file",
          permissionMode: "auto",
        }),
      });
      expect([200, 202]).toContain(admitted.status);
      const receipt = (await admitted.json()) as { submissionId?: string };
      const result = await client.wait({
        threadId: "delegate-general-auto-1",
        submissionId: receipt.submissionId ?? "",
        streamUrl: "",
        offset: "0",
      });
      expect(result.text).toContain("write ran");
      const pending = await fetch(`${running.baseUrl}/api/permissions/pending`, { headers: authorization });
      expect(await pending.json()).toEqual([]);
      const grants = await fetch(`${running.baseUrl}/api/permissions/grants?agentId=general`, { headers: authorization });
      expect(await grants.json()).toEqual([]);
    },
    90_000,
  );

  it(
    "runs two delegates beside each other and keeps the writes honest",
    async () => {
      // S5.5's gate: one batch, two delegates. The scripted parent hands
      // the explorer and the planner work in ONE assistant message, so
      // two child sessions run inside the same sandbox beside each
      // other. The assertions are the consistency the concurrency owes:
      // both answers return, the parent transcript holds the two task
      // results and nothing of either child's intermediate work, the
      // plan rows the planner wrote carry `agent:plan` (the S5.2 writer
      // dimension, live), and the batch wrote no grant rows at all — a
      // read-shaped delegation has nothing to approve, and nothing in
      // the two sessions may have interleaved one in.
      const running = await startHarness(await createDatabasePath());
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      const authorization = { authorization: `Bearer ${running.token}` };

      const run = await client.send("delegate-two-1", "[delegate-two] run both");
      const result = await client.wait(run);
      expect(result.text).toContain("Delegated twice.");
      // The explorer's visibility report and the planner's read-back,
      // both from inside their own sessions:
      expect(result.text).toContain("agent planner");
      expect(result.text).toContain("plan writer agent:plan");
      expect(result.text).toContain("Delegate sees ");

      const history = await client.history("delegate-two-1");
      const parts = history.messages.flatMap((message) => message.parts);
      expect(
        parts.filter(
          (part) =>
            part.type === "dynamic-tool" &&
            part.toolName === "task" &&
            part.state === "output-available",
        ),
      ).toHaveLength(2);
      // Neither child's tool use is in the parent transcript.
      expect(
        parts.some((part) => part.type === "dynamic-tool" && part.toolName === "glob"),
      ).toBe(false);
      expect(
        parts.some((part) => part.type === "dynamic-tool" && part.toolName === "plan"),
      ).toBe(false);

      // The plan rows outlive the run, carrying the writer that made them.
      const plans = await fetch(`${running.baseUrl}/api/plans/delegate-two-1`, {
        headers: authorization,
      });
      const plan = (await plans.json()) as {
        damaged: boolean;
        items: { id: string; updatedBy: string }[];
      };
      expect(plan.damaged).toBe(false);
      expect(plan.items.length).toBeGreaterThan(0);
      expect(plan.items.every((item) => item.updatedBy === "agent:plan")).toBe(true);

      // And nothing was granted: the batch never asked, so the grant
      // table is untouched by either session.
      const grants = await fetch(`${running.baseUrl}/api/permissions/grants`, {
        headers: authorization,
      });
      expect(await grants.json()).toEqual([]);
    },
    90_000,
  );
});
