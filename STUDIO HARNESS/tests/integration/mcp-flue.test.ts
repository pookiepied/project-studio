import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

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

async function waitUntil(predicate: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Condition was not met within ${timeoutMs}ms.`);
}

async function startHarness(databasePath: string): Promise<RunningHarness> {
  const portNumber = await port();
  const admission = createAdmissionSession({ clientType: "test" });
  const child = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(portNumber),
      PROJECT_STUDIO_ADMISSION_CREDENTIAL: admission.credential,
      PROJECT_STUDIO_DB_PATH: join(databasePath, "flue.db"),
      PROJECT_STUDIO_STORE_PATH: join(databasePath, "studio.db"),
      PROJECT_STUDIO_MODEL_SOURCE: "test",
    },
    stdio: "pipe",
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    output += chunk.toString();
  });
  const baseUrl = `http://127.0.0.1:${portNumber}`;
  await waitUntil(async () => {
    if (child.exitCode !== null) return false;
    try {
      await fetch(baseUrl);
      return true;
    } catch {
      return false;
    }
  });
  return { baseUrl, process: child, token: admission.credential, output: () => output };
}

async function stopHarness(harness: RunningHarness): Promise<void> {
  if (harness.process.exitCode !== null) return;
  harness.process.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      harness.process.kill("SIGKILL");
      resolve();
    }, 5_000);
    harness.process.once("exit", () => {
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

  it("runs a real selected tool through approval and removes it after disable", async () => {
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
