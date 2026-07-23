import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { FlueConversationMessage } from "@flue/sdk";
import { afterEach, describe, expect, it } from "vitest";

import {
  FlueHarnessClient,
  type AcceptedRun,
} from "../../src/application/harness-client.js";

interface RunningHarness {
  baseUrl: string;
  process: ChildProcess;
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
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

async function startHarness(databasePath: string): Promise<RunningHarness> {
  const port = await availablePort();
  const child = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      PROJECT_STUDIO_DB_PATH: databasePath,
    },
    stdio: "pipe",
  });
  processes.add(child);

  let stderr = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitUntil(async () => {
    if (child.exitCode !== null) {
      throw new Error(`Harness exited during startup: ${stderr}`);
    }

    try {
      await fetch(baseUrl);
      return true;
    } catch {
      return false;
    }
  });

  return { baseUrl, process: child };
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
  it("accepts a run, streams renderable state, and keeps thread continuity", async () => {
    const running = await startHarness(await createDatabasePath());
    const client = new FlueHarnessClient({ baseUrl: running.baseUrl });
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
  });

  it("continues after a typed tool call and records the tool exchange", async () => {
    const running = await startHarness(await createDatabasePath());
    const client = new FlueHarnessClient({ baseUrl: running.baseUrl });

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
  });

  it("cancels accepted work with a durable aborted outcome", async () => {
    const running = await startHarness(await createDatabasePath());
    const client = new FlueHarnessClient({ baseUrl: running.baseUrl });

    const run = await client.send("cancel", "[slow] please wait");
    expect(await client.cancel("cancel")).toBe(true);
    await expect(client.wait(run)).rejects.toThrow();

    const history = await client.history("cancel");
    expect(
      history.settlements.find(
        (settlement) => settlement.submissionId === run.submissionId,
      )?.outcome,
    ).toBe("aborted");
  });

  it(
    "resumes an accepted submission after a Node process restart",
    async () => {
      const databasePath = await createDatabasePath();
      const firstServer = await startHarness(databasePath);
      const firstClient = new FlueHarnessClient({
        baseUrl: firstServer.baseUrl,
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
      });

      const result = await replacementClient.wait(resumedRun);
      expect(result.text).toBe("Echo: survive restart");
    },
    45_000,
  );
});
