import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FlueHarnessClient } from "../../src/application/harness-client.js";

interface RunningHarness {
  baseUrl: string;
  process: ChildProcess;
  dumpPath: string;
}

interface DumpedSpan {
  name: string;
  kind: number;
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
}

interface DumpedTelemetry {
  spans: DumpedSpan[];
  metrics: Array<{
    scopeMetrics: Array<{
      metrics: Array<{ name: string; dataPointCount: number }>;
    }>;
  }>;
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

async function createTempDir(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "project-studio-otel-"));
  temporaryDirectories.add(directory);
  return directory;
}

async function startHarness(options: {
  captureContent?: boolean;
}): Promise<RunningHarness> {
  const directory = await createTempDir();
  const databasePath = join(directory, "flue.db");
  const dumpPath = join(directory, "telemetry.json");
  const port = await availablePort();

  const child = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      PROJECT_STUDIO_DB_PATH: databasePath,
      PROJECT_STUDIO_OTEL_EXPORTER: "memory",
      PROJECT_STUDIO_OTEL_MEMORY_DUMP_PATH: dumpPath,
      PROJECT_STUDIO_DEPLOYMENT_ENVIRONMENT: "test",
      PROJECT_STUDIO_OTEL_CAPTURE_CONTENT: options.captureContent
        ? "true"
        : "false",
      OTEL_GENAI_CAPTURE_CONTENT: options.captureContent ? "true" : "false",
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

  return { baseUrl, process: child, dumpPath };
}

async function stopHarness(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 8_000);
      child.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  processes.delete(child);
}

async function readDump(dumpPath: string): Promise<DumpedTelemetry> {
  await waitUntil(async () => {
    try {
      await readFile(dumpPath, "utf8");
      return true;
    } catch {
      return false;
    }
  }, 10_000);

  return JSON.parse(await readFile(dumpPath, "utf8")) as DumpedTelemetry;
}

function metricNames(dump: DumpedTelemetry): string[] {
  return dump.metrics.flatMap((resource) =>
    resource.scopeMetrics.flatMap((scope) =>
      scope.metrics.map((metric) => metric.name),
    ),
  );
}

function attributeText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
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

describe.sequential("observability vertical slice", () => {
  it(
    "emits agent/model/tool span hierarchy and metrics without content by default",
    async () => {
      const running = await startHarness({ captureContent: false });
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl });

      const run = await client.send("otel-tools", "check the workspace");
      expect((await client.wait(run)).text).toBe(
        "Project Studio V2 workspace is ready.",
      );

      // Spans dump on end; wait briefly for metric periodic export on Windows
      // where SIGTERM does not run process exit hooks.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const dump = await readDump(running.dumpPath);
      await stopHarness(running.process);

      const agent = dump.spans.find((span) =>
        span.name.startsWith("invoke_agent"),
      );
      const chat = dump.spans.find((span) => span.name.startsWith("chat "));
      const tool = dump.spans.find((span) =>
        span.name.startsWith("execute_tool"),
      );

      expect(agent).toBeDefined();
      expect(chat).toBeDefined();
      expect(tool).toBeDefined();
      expect(tool?.name).toContain("workspace_summary");

      expect(chat?.parentSpanId).toBe(agent?.spanId);
      expect(tool?.parentSpanId).toBe(agent?.spanId);
      expect(chat?.traceId).toBe(agent?.traceId);
      expect(tool?.traceId).toBe(agent?.traceId);

      const contentKeys = dump.spans.flatMap((span) =>
        Object.keys(span.attributes).filter(
          (key) =>
            key === "gen_ai.input.messages" ||
            key === "gen_ai.output.messages" ||
            key === "gen_ai.system_instructions" ||
            key === "gen_ai.tool.call.arguments" ||
            key === "gen_ai.tool.call.result" ||
            key === "gen_ai.tool.definitions" ||
            key === "gen_ai.tool.description",
        ),
      );
      expect(contentKeys).toEqual([]);

      const names = metricNames(dump);
      expect(names).toEqual(
        expect.arrayContaining([
          "gen_ai.invoke_agent.duration",
          "gen_ai.execute_tool.duration",
        ]),
      );
    },
    30_000,
  );

  it(
    "applies redaction when content capture is enabled",
    async () => {
      const running = await startHarness({ captureContent: true });
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl });

      const secretMessage =
        "hello token=super-secret-value and Bearer sk-abcdefghijklmnopqrst";
      const run = await client.send("otel-redact", secretMessage);
      expect((await client.wait(run)).text).toContain("Echo:");

      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const dump = await readDump(running.dumpPath);
      await stopHarness(running.process);

      const serialized = JSON.stringify(dump);
      expect(serialized).not.toContain("super-secret-value");
      expect(serialized).not.toContain("sk-abcdefghijklmnopqrst");

      const contentAttributes = dump.spans.flatMap((span) =>
        Object.entries(span.attributes).filter(
          ([key]) =>
            key === "gen_ai.input.messages" ||
            key === "gen_ai.output.messages" ||
            key === "gen_ai.system_instructions" ||
            key === "gen_ai.tool.call.arguments" ||
            key === "gen_ai.tool.call.result",
        ),
      );

      expect(contentAttributes.length).toBeGreaterThan(0);
      for (const [, value] of contentAttributes) {
        const text = attributeText(value);
        expect(text).not.toContain("super-secret-value");
        expect(text).not.toContain("sk-abcdefghijklmnopqrst");
      }
      expect(serialized).toContain("[REDACTED]");
    },
    30_000,
  );

  it(
    "represents cancellation with error status on agent spans",
    async () => {
      const running = await startHarness({ captureContent: false });
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl });

      const run = await client.send("otel-cancel", "[slow] please wait");
      expect(await client.cancel("otel-cancel")).toBe(true);
      await expect(client.wait(run)).rejects.toThrow();

      await new Promise((resolve) => setTimeout(resolve, 1_200));
      const dump = await readDump(running.dumpPath);
      await stopHarness(running.process);

      const agentSpans = dump.spans.filter((span) =>
        span.name.startsWith("invoke_agent"),
      );
      expect(agentSpans.length).toBeGreaterThan(0);
      expect(
        agentSpans.some(
          (span) =>
            span.status.code === 2 ||
            span.attributes["error.type"] !== undefined ||
            span.attributes["flue.submission.outcome"] === "aborted",
        ),
      ).toBe(true);
    },
    30_000,
  );
});
