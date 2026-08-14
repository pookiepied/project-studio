import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import { FlueHarnessClient } from "../../src/application/harness-client.js";

/**
 * End-to-end proof that the Studio gateway adapter drives a real generated
 * Flue server: a spawned Node process runs `dist/server.mjs` with the
 * studio-cloud source pointed at a local mock gateway. No real network, no
 * Cloudflare account, and no paid provider are involved.
 */

const DEV_TOKEN = "dev-bootstrap-token-value";
const DEFAULT_MODEL = "anthropic:claude-sonnet-5";

interface RecordedRequest {
  url: string;
  authorization: string | undefined;
  body: unknown;
}

interface MockGateway {
  server: Server;
  url: string;
  requests: RecordedRequest[];
  /** Resolves once an upstream chat connection has been observed as closed. */
  sawClientClose: () => boolean;
  setHoldOpen: (value: boolean) => void;
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

const CATALOG = {
  object: "list",
  data: [
    {
      id: DEFAULT_MODEL,
      provider: "anthropic",
      providerModelId: "claude-sonnet-5",
      contextWindow: 200_000,
      maxTokens: 64_000,
      capabilities: {
        modalities: ["chat"],
        chat: { streaming: true, vision: true, tools: true, reasoning: { supported: true } },
      },
    },
  ],
};

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function hasToolResult(body: unknown): boolean {
  const messages = (body as { messages?: Array<{ role?: string }> }).messages ?? [];
  return messages.some((message) => message.role === "tool");
}

/**
 * The tool-call turn. Two calls prove multiple tool calls survive intact and
 * are both executed by Flue.
 */
function toolCallTurn(): string {
  const call1 = { id: "call-alpha", type: "function", function: { name: "workspace_summary", arguments: '{"workspace":"alpha"}' } };
  const call2 = { id: "call-beta", type: "function", function: { name: "workspace_summary", arguments: '{"workspace":"beta"}' } };
  return (
    frame("stream.started", { type: "stream.started", provider: "anthropic", model: DEFAULT_MODEL }) +
    frame("tool_call", { type: "tool_call", call: call1 }) +
    frame("model.tool_call.completed", { type: "model.tool_call.completed", call: call1 }) +
    frame("tool_call", { type: "tool_call", call: call2 }) +
    frame("model.tool_call.completed", { type: "model.tool_call.completed", call: call2 }) +
    frame("tool_calls", { type: "tool_calls", calls: [call1, call2] }) +
    frame("model.completed", { type: "model.completed", finishReason: "tool-calls" }) +
    frame("stream.completed", { type: "stream.completed" }) +
    "data: [DONE]\n\n"
  );
}

/** The final turn: reasoning then text, proving both stream through Flue. */
function finalTurn(): string {
  return (
    frame("stream.started", { type: "stream.started", provider: "anthropic", model: DEFAULT_MODEL }) +
    frame("reasoning", { type: "reasoning", chunk: "checking " }) +
    frame("model.reasoning.delta", { type: "model.reasoning.delta", chunk: "checking " }) +
    frame("reasoning", { type: "reasoning", chunk: "workspaces" }) +
    frame("model.reasoning.delta", { type: "model.reasoning.delta", chunk: "workspaces" }) +
    frame("content", { type: "content", chunk: "Both workspaces " }) +
    frame("model.message.delta", { type: "model.message.delta", chunk: "Both workspaces " }) +
    frame("content", { type: "content", chunk: "are ready." }) +
    frame("model.message.delta", { type: "model.message.delta", chunk: "are ready." }) +
    frame("usage", { type: "usage", data: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 } }) +
    frame("model.usage", { type: "model.usage", data: { prompt_tokens: 30, completion_tokens: 8, total_tokens: 38 } }) +
    frame("model.completed", { type: "model.completed", finishReason: "stop" }) +
    frame("stream.completed", { type: "stream.completed" }) +
    "data: [DONE]\n\n"
  );
}

async function startMockGateway(): Promise<MockGateway> {
  const requests: RecordedRequest[] = [];
  let sawClose = false;
  let holdOpen = false;

  const server = createHttpServer((request: IncomingMessage, response: ServerResponse) => {
    void (async () => {
      const raw = await readBody(request);
      const body = raw ? JSON.parse(raw) : undefined;
      requests.push({ url: request.url ?? "", authorization: request.headers.authorization, body });

      if (request.url === "/v1/models") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(CATALOG));
        return;
      }

      if (request.url === "/v1/chat/completions") {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
        });

        if (holdOpen) {
          response.write(frame("stream.started", { type: "stream.started" }));
          response.write(frame("model.message.delta", { type: "model.message.delta", chunk: "partial" }));
          // When the caller cancels, the upstream connection is torn down.
          const markClosed = () => {
            sawClose = true;
          };
          response.on("close", markClosed);
          request.on("aborted", markClosed);
          request.on("close", markClosed);
          return; // never ends on its own
        }

        response.write(hasToolResult(body) ? finalTurn() : toolCallTurn());
        response.end();
        return;
      }

      response.writeHead(404, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "ROUTE_NOT_FOUND", message: "no" } }));
    })();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no mock port");

  return {
    server,
    url: `http://127.0.0.1:${address.port}`,
    requests,
    sawClientClose: () => sawClose,
    setHoldOpen: (value: boolean) => {
      holdOpen = value;
    },
  };
}

async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a test port."));
        return;
      }
      const { port } = address;
      probe.close((error) => (error ? reject(error) : resolve(port)));
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

interface RunningHarness {
  baseUrl: string;
  process: ChildProcess;
  token: string;
  readStdio: () => string;
}

async function startHarness(gatewayUrl: string, databasePath: string): Promise<RunningHarness> {
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
      PROJECT_STUDIO_MODEL_SOURCE: "studio-cloud",
      PROJECT_STUDIO_GATEWAY_URL: gatewayUrl,
      PROJECT_STUDIO_GATEWAY_TOKEN: DEV_TOKEN,
      PROJECT_STUDIO_GATEWAY_DEFAULT_MODEL: DEFAULT_MODEL,
    },
    stdio: "pipe",
  });

  let stdio = "";
  child.stdout?.on("data", (chunk: Buffer) => {
    stdio += chunk.toString();
  });
  child.stderr?.on("data", (chunk: Buffer) => {
    stdio += chunk.toString();
  });

  const baseUrl = `http://127.0.0.1:${port}`;
  await waitUntil(async () => {
    if (child.exitCode !== null) {
      throw new Error(`Harness exited during startup: ${stdio}`);
    }
    try {
      await fetch(baseUrl);
      return true;
    } catch {
      return false;
    }
  });

  return { baseUrl, process: child, token: admission.credential, readStdio: () => stdio };
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
}

let mock: MockGateway;
let harness: RunningHarness | undefined;
let databaseDir: string;

beforeEach(async () => {
  mock = await startMockGateway();
  databaseDir = await mkdtemp(join(tmpdir(), "studio-flue-"));
});

afterEach(async () => {
  if (harness) {
    await stopHarness(harness.process);
    harness = undefined;
  }
  await new Promise<void>((resolve) => mock.server.close(() => resolve()));
  await rm(databaseDir, { recursive: true, force: true });
});

describe.sequential("studio-cloud source through a real Flue server", () => {
  it(
    "runs a full tool-continuation turn against the mock gateway",
    async () => {
      harness = await startHarness(mock.url, join(databaseDir, "flue.db"));
       const client = new FlueHarnessClient({ baseUrl: harness.baseUrl, token: harness.token });

      const run = await client.send("tools", "check the workspace");
      const result = await client.wait(run);

      // Final assistant response settles successfully with the gateway's text.
      expect(result.text).toBe("Both workspaces are ready.");

      // The user message reached the mock, and a tool-continuation round trip
      // happened: first a tool-call turn, then a turn carrying the results.
      const chatRequests = mock.requests.filter((request) => request.url === "/v1/chat/completions");
      expect(chatRequests.length).toBeGreaterThanOrEqual(2);
      expect(chatRequests[0]?.authorization).toBe(`Bearer ${DEV_TOKEN}`);

      const firstMessages = (chatRequests[0]?.body as { messages: Array<{ role: string; content: unknown }> }).messages;
      expect(firstMessages.some((message) => message.role === "user")).toBe(true);

      // The second request replays both assistant tool calls in order and the
      // correlated tool results.
      const secondMessages = (chatRequests[1]?.body as {
        messages: Array<{ role: string; toolCallId?: string; toolCalls?: Array<{ id: string; name: string }> }>;
      }).messages;

      const assistant = secondMessages.find((message) => message.role === "assistant" && message.toolCalls);
      expect(assistant?.toolCalls?.map((call) => call.id)).toEqual(["call-alpha", "call-beta"]);

      const toolResults = secondMessages.filter((message) => message.role === "tool");
      expect(toolResults.map((message) => message.toolCallId).sort()).toEqual(["call-alpha", "call-beta"]);

      // Flue actually executed the registered tool: history shows both
      // tool exchanges with output, plus streamed reasoning and text.
      const history = await client.history("tools");
      const parts = history.messages.flatMap((message) => message.parts);

      const toolParts = parts.filter(
        (part) => part.type === "dynamic-tool" && part.toolName === "workspace_summary",
      );
      expect(toolParts.length).toBe(2);
      expect(
        toolParts.every((part) => part.type === "dynamic-tool" && part.state === "output-available"),
      ).toBe(true);

      expect(parts.some((part) => part.type === "reasoning" && part.text.includes("checking"))).toBe(true);
      expect(parts.some((part) => part.type === "text" && part.text.includes("Both workspaces"))).toBe(true);

      // No token appears in conversation history, events, or server logs.
      expect(JSON.stringify(history)).not.toContain(DEV_TOKEN);
      expect(harness.readStdio()).not.toContain(DEV_TOKEN);
    },
    60_000,
  );

  it(
    "closes the upstream request when the run is cancelled",
    async () => {
      mock.setHoldOpen(true);
      harness = await startHarness(mock.url, join(databaseDir, "flue.db"));
       const client = new FlueHarnessClient({ baseUrl: harness.baseUrl, token: harness.token });

      const run = await client.send("cancel", "check the workspace");

      // Wait for the upstream chat request to be in flight, then cancel.
      await waitUntil(async () =>
        mock.requests.some((request) => request.url === "/v1/chat/completions"),
      );
      expect(await client.cancel("cancel")).toBe(true);
      await expect(client.wait(run)).rejects.toThrow();

      await waitUntil(async () => mock.sawClientClose());
      expect(mock.sawClientClose()).toBe(true);
      expect(harness.readStdio()).not.toContain(DEV_TOKEN);
    },
    60_000,
  );
});
