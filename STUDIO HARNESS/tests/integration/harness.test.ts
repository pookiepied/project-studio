import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { FlueConversationMessage } from "@flue/sdk";
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
 * A healthy start is well under a second. This is not a threshold anything is
 * expected to approach, and raising it is explicitly **not** the fix for `E-02`
 * — the report above is. It is set far beyond any plausible boot so that when it
 * does expire, the machine was genuinely wedged and the message says so.
 */
const STARTUP_BUDGET_MS = 60_000;

async function startHarness(databasePath: string): Promise<RunningHarness> {
  const port = await availablePort();
  const admission = createAdmissionSession({ clientType: "test" });
  const child = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      PROJECT_STUDIO_ADMISSION_CREDENTIAL: admission.credential,
      PROJECT_STUDIO_DB_PATH: databasePath,
      PROJECT_STUDIO_STORE_PATH: join(dirname(databasePath), "studio.db"),
    },
    stdio: "pipe",
  });
  processes.add(child);

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  // Captured as well as stderr, because the harness reports its own startup on
  // stdout. Whether it got as far as saying anything is the first thing worth
  // knowing about a start that never finished.
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

  await waitUntil(
    async () => {
      if (child.exitCode !== null) {
        throw new Error(`Harness exited during startup: ${stderr}`);
      }

      try {
        await fetch(baseUrl);
        return true;
      } catch (error) {
        lastProbeError = error;
        return false;
      }
    },
    STARTUP_BUDGET_MS,
    () =>
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
      ].join("\n  "),
  );

  return { baseUrl, process: child, token: admission.credential };
}

async function stopHarness(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 3_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
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
});
