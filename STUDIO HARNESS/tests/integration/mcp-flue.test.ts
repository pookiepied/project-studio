import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { itContained } from "../contained.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { FlueHarnessClient } from "../../src/application/harness-client.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";
import { openDatabase } from "../../src/storage/database.js";
import { projectKey } from "../../src/snapshots/shadow-repo.js";

const SERVER = `
process.stdin.setEncoding("utf8");
let buffer = "";
function reply(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n");
}
function handle(message) {
  if (message.method === "server/discover") {
    reply(message.id, { protocolVersion: "2026-07-28", capabilities: {} });
  } else if (message.method === "tools/list") {
    reply(message.id, {
      tools: [{
        name: "echo",
        description: "Echo the supplied text",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      }],
    });
  } else if (message.method === "tools/call") {
    reply(message.id, { content: [{ type: "text", text: message.params.arguments.text }] });
  }
}
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  for (;;) {
    const end = buffer.indexOf("\\n");
    if (end < 0) break;
    const line = buffer.slice(0, end);
    buffer = buffer.slice(end + 1);
    if (line.trim() !== "") handle(JSON.parse(line));
  }
});
`;

interface RunningHarness {
  readonly baseUrl: string;
  readonly process: ChildProcess;
  readonly token: string;
  readonly output: () => string;
}

async function port(): Promise<number> {
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

/** Same envelope as `harness.test.ts`: see the reasoning on its constants. */
const STARTUP_BUDGET_MS = 20_000;

/**
 * A start attempt that has produced not one byte on either pipe after this
 * long is wedged, not slow. The window exists because the failure this suite
 * kept hitting was exactly that shape — alive, unexited, silent for the whole
 * budget — while every healthy boot, however loaded the machine, has spoken
 * within a few seconds of starting.
 */
const STARTUP_SILENCE_MS = 10_000;

/**
 * Thrown when an attempt crosses the silence window. Consumed by the
 * replacement logic below; reaches a test only as text folded into the final
 * failure.
 */
class StartupSilent extends Error {}

interface HarnessStartOptions {
  readonly entry?: string;
  readonly startupBudgetMs?: number;
  readonly startupSilenceMs?: number;
}

async function waitUntil(
  predicate: () => Promise<boolean>,
  timeoutMs = 20_000,
  describeFailure?: () => string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  const suffix = describeFailure === undefined ? "" : describeFailure();
  throw new Error(`Condition was not met within ${timeoutMs}ms.${suffix}`);
}

/**
 * Starts a harness with the same instrumentation `harness.test.ts` uses:
 * named pids, stream tails, a silence window with one same-budget
 * replacement, and a child exit treated as a reason rather than as more
 * waiting. It is a copy rather than a shared import because extracting the
 * five integration helpers is deliberately queued elsewhere; until then this
 * file carries its own, and the weakest instrument on the most contended path
 * was the one that had none of it.
 *
 * The history this replaces: no pid in failures, tails only via one opaque
 * `output()` blob, a child that exited mid-startup treated as retryable-false
 * (so a harness that died immediately cost the full timeout instead of naming
 * itself), and silence waited out to the very end.
 */
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
    const portNumber = await port();
    const admission = createAdmissionSession({ clientType: "test" });
    const attemptStartedAt = Date.now();
    const child = spawn(process.execPath, [options.entry ?? "dist/server.mjs"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        PORT: String(portNumber),
        PROJECT_STUDIO_ADMISSION_CREDENTIAL: admission.credential,
        PROJECT_STUDIO_DB_PATH: join(databasePath, "flue.db"),
        PROJECT_STUDIO_STORE_PATH: join(databasePath, "studio.db"),
        PROJECT_STUDIO_MODEL_SOURCE: "test",
      },
      // An IPC channel alongside the pipes, so shutdown can be *requested* on
      // Windows, where SIGTERM maps to TerminateProcess and never reaches a
      // handler. The harness listens for the message as well.
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    /** The last of a stream, which is where the reason for a bad start is. */
    const tail = (text: string): string =>
      text.length > 2_000 ? `...${text.slice(-2_000)}` : text;

    const baseUrl = `http://127.0.0.1:${portNumber}`;
    /** Kept so the failure can say what the last probe actually objected to. */
    let lastProbeError: unknown;
    // Undici's top-level sentence is "fetch failed" for a refused connection
    // and for a timed-out one alike; the difference is carried up from cause.
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

      return { baseUrl, process: child, token: admission.credential, output: () => stdout + stderr };
    } catch (error) {
      // One replacement, and only while enough of the budget remains for the
      // next attempt to be fair; otherwise the failure carries everything known.
      const replaceable =
        error instanceof StartupSilent &&
        replaced.length === 0 &&
        budgetMs - (Date.now() - startedAt) >= Math.ceil(silenceMs / 2);
      if (replaceable) {
        replaced.push(
          `pid=${String(child.pid)} on port ${String(portNumber)}, killed after ${String(Date.now() - attemptStartedAt)}ms with no output`,
        );
        await killHarness(child);
        continue;
      }
      if (error instanceof Error) error.message = withReplacedAttempts(error.message);
      throw error;
    }
  }
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
}

async function stopHarness(harness: RunningHarness): Promise<void> {
  const child = harness.process;
  if (child.exitCode !== null || child.signalCode !== null) return;
  // Ask over IPC when there is a channel, because a signal cannot carry this
  // on Windows; SIGTERM remains the fallback for a child without one.
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

describe("MCP through the Flue agent", () => {
  let harness: RunningHarness | undefined;
  let directory: string | undefined;

  afterEach(async () => {
    if (harness !== undefined) await stopHarness(harness);
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
    harness = undefined;
    directory = undefined;
  });

  // Starts a real stdio MCP server, so it needs a host that can contain one.
  // The refusal on a host that cannot is asserted in the sandbox suites.
  itContained("runs a real selected tool through approval and removes it after disable", async () => {
    directory = await mkdtemp(join(tmpdir(), "studio-mcp-flue-"));
    const script = join(directory, "server.mjs");
    await writeFile(script, SERVER, "utf8");
    const studioDatabase = join(directory, "studio.db");
    const trustedDatabase = openDatabase({ path: studioDatabase });
    new WorkspaceTrustStore(trustedDatabase).set(process.cwd(), true);
    trustedDatabase.close();
    harness = await startHarness(directory);

    const config = {
      id: "echo-server",
      title: "Echo server",
      transport: "stdio",
      command: process.execPath,
      args: [script],
      env: {},
      auth: "none",
    };
    const saved = await fetch(`${harness.baseUrl}/api/mcp/servers`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${harness.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(config),
    });
    expect(saved.status).toBe(201);

    const enabled = await fetch(
      `${harness.baseUrl}/api/mcp/projects/${encodeURIComponent(projectKey(process.cwd()))}/extensions/mcp/echo-server`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${harness.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: true }),
      },
    );
    expect(enabled.status).toBe(200);

    const client = new FlueHarnessClient({ baseUrl: harness.baseUrl, token: harness.token });
    const run = await client.send("mcp", "use mcp");
    await waitUntil(async () => {
      const response = await fetch(`${harness?.baseUrl}/api/permissions/pending`, {
        headers: { authorization: `Bearer ${harness?.token}` },
      });
      const pending = (await response.json()) as readonly unknown[];
      return pending.length > 0;
    }).catch(() => {
      throw new Error(`No approval arrived. Harness output: ${harness?.output()}`);
    });

    const pendingResponse = await fetch(`${harness.baseUrl}/api/permissions/pending`, {
      headers: { authorization: `Bearer ${harness.token}` },
    });
    const pending = (await pendingResponse.json()) as readonly { id: string }[];
    await fetch(`${harness.baseUrl}/api/permissions/pending/${pending[0]?.id}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${harness.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ verdict: "allow", duration: "always" }),
    });

    expect((await client.wait(run)).text).toBe("MCP tool completed.");

    const disabled = await fetch(
      `${harness.baseUrl}/api/mcp/projects/${encodeURIComponent(projectKey(process.cwd()))}/extensions/mcp/echo-server`,
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${harness.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ enabled: false }),
      },
    );
    expect(disabled.status).toBe(200);

    const next = await client.send("mcp-off", "use mcp again");
    expect((await client.wait(next)).text).toBe("Echo: use mcp again");
  }, 60_000);
});

describe("the startup silence window", () => {
  it("replaces a harness that produces no output and names both attempts in the failure", async () => {
    // A deterministic stand-in for a machine-stalled boot: alive, listening on
    // nothing, writing not one byte to either pipe. This suite was the second
    // sighting of that shape and had the least instrumentation for it; the
    // stub drives the same kill-and-replace machinery `harness.test.ts` pins,
    // so the helper here cannot quietly lose it again.
    const directory = await mkdtemp(join(tmpdir(), "studio-mcp-flue-silent-"));
    const entry = join(directory, "never-speaks.mjs");
    await writeFile(entry, "setInterval(() => {}, 1000);\n", "utf8");

    let failure: unknown;
    try {
      await startHarness(directory, {
        entry,
        startupBudgetMs: 3_000,
        startupSilenceMs: 600,
      });
    } catch (error) {
      failure = error;
    }

    if (!(failure instanceof Error)) {
      throw new Error("startHarness resolved instead of failing.");
    }
    const pids = [...failure.message.matchAll(/pid=(\d+)/g)].map((match) => match[1]);
    expect(new Set(pids).size).toBe(2);
    expect(failure.message).toContain(
      "An earlier attempt was replaced for staying silent",
    );
    expect(failure.message).toContain("never accepted a connection");

    await rm(directory, { recursive: true, force: true });
  });
});
