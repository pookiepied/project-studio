import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import type { DiagnosticPage } from "../../src/contracts/diagnostics.js";
import { FlueHarnessClient } from "../../src/application/harness-client.js";
import { openDatabase } from "../../src/storage/database.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";

interface RunningHarness {
  baseUrl: string;
  process: ChildProcess;
  token: string;
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
  autoConversation?: string;
}): Promise<RunningHarness> {
  const directory = await createTempDir();
  const databasePath = join(directory, "flue.db");
  const dumpPath = join(directory, "telemetry.json");
  const port = await availablePort();
  const admission = createAdmissionSession({ clientType: "test", scopes: ALL_ADMISSION_SCOPES });

  if (options.autoConversation !== undefined) {
    const database = openDatabase({ path: join(directory, "studio.db") });
    new ConversationStore(database).record({ id: options.autoConversation, firstMessage: "Fixture", permissionMode: "auto" });
    new WorkspaceTrustStore(database).set(join(directory, "data", "conversations", options.autoConversation, "workspace"), true);
    database.close();
  }

  const child = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      PROJECT_STUDIO_ADMISSION_CREDENTIAL: admission.credential,
      PROJECT_STUDIO_DB_PATH: databasePath,
      PROJECT_STUDIO_STORE_PATH: join(directory, "studio.db"),
      // The whole Studio home travels with the database: an agent turn now
      // creates its conversation tree under it, and a test must not write
      // there under the developer's real home.
      PROJECT_STUDIO_HOME: directory,
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

  return { baseUrl, process: child, token: admission.credential, dumpPath };
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
  // Wait for a dump that parses, not merely one that exists: the exporter
  // writes the file in place, and a read that lands between the open and the
  // last byte sees "Unexpected end of JSON input" (measured under a full run
  // on 2026-09-15).
  let dump: DumpedTelemetry | null = null;
  await waitUntil(async () => {
    try {
      dump = JSON.parse(await readFile(dumpPath, "utf8")) as DumpedTelemetry;
      return true;
    } catch {
      return false;
    }
  }, 10_000);
  if (dump === null) throw new Error(`No telemetry dump was written at ${dumpPath}.`);
  return dump;
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
  it("preserves the latest request across job start and stop without changing instructions", async () => {
    const running = await startHarness({ captureContent: false, autoConversation: "job-continuity" });
    const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
    await client.wait(await client.send("job-continuity", "earlier-html-task: create only a plain HTML file."));
    const result = await client.wait(await client.send("job-continuity", "[job-continuity] build-next-project: now use a framework in a separate folder."));
    expect(JSON.parse(result.text)).toEqual({
      earlierRequestPresent: true,
      currentRequestPresent: true,
      jobStarted: true,
      stopRequested: true,
      instructionChurn: false,
    });
  });

  it("captures original scoped runtime envelope fields through the installed snapshot-source bridge", async () => {
    const running = await startHarness({ captureContent: false });
    const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };
    const configured = await fetch(`${running.baseUrl}/api/diagnostics/policy`, { method: "PUT", headers,
      body: JSON.stringify({ enabled: true, captureContent: true, conversations: ["diagnostic-tools"] }) });
    expect(configured.status).toBe(200);
    const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
    await client.wait(await client.send("diagnostic-tools", "check the workspace"));
    const response = await fetch(`${running.baseUrl}/api/diagnostics/events?limit=500`, { headers });
    const page = await response.json() as DiagnosticPage;
    const call = page.events.find((event) => event.name === "runtime.tool_start");
    expect(call).toBeDefined();
    expect(call?.contentState).toBe("captured");
    expect(call?.content).toHaveProperty("args.pattern", "**/*");
    const request = page.events.find((event) => event.name === "runtime.turn_request");
    expect(request?.content).toHaveProperty("request.providerName");
    // The fixture's full system prompt exceeds the local content budget.
    expect(request?.contentState).toBe("truncated");
  });
  it("captures real runtime and tool boundaries behind explicit local recording policy", async () => {
    const running = await startHarness({ captureContent: false });
    const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };
    const configured = await fetch(`${running.baseUrl}/api/diagnostics/policy`, { method: "PUT", headers, body: JSON.stringify({ enabled: true }) });
    expect(configured.status).toBe(200);
    const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
    const run = await client.send("diagnostic-tools", "check the workspace");
    await client.wait(run);
    const second = await client.send("diagnostic-tools", "hello again");
    await client.wait(second);
    const response = await fetch(`${running.baseUrl}/api/diagnostics/events?limit=500`, { headers });
    const page = await response.json() as DiagnosticPage;
    const names = page.events.map((event) => event.name);
    expect(names).toEqual(expect.arrayContaining(["runtime.turn_request", "execution.model", "tools.validate", "tools.execute", "runtime.submission_settled"]));
    expect(page.events.every((event) => event.content === undefined)).toBe(true);
    expect(page.events.filter((event) => event.name === "runtime.turn_request").every((event) => event.identity.conversationId === "diagnostic-tools")).toBe(true);
    const admissions = [run, second].map((sent) => page.events.find((event) => event.name === "http.admission" && event.identity.submissionId === sent.submissionId));
    expect(admissions[0]?.identity.requestId).toBeDefined();
    expect(admissions[1]?.identity.requestId).toBeDefined();
    expect(admissions[0]?.identity.requestId).not.toBe(admissions[1]?.identity.requestId);
    for (const sent of [run, second]) {
      const admission = admissions.find((event) => event?.identity.submissionId === sent.submissionId);
      const executed = page.events.filter((event) => event.identity.submissionId === sent.submissionId &&
        (event.name === "execution.model" || event.name === "runtime.turn_request"));
      expect(executed.length).toBeGreaterThan(0);
      expect(executed.every((event) => event.identity.requestId === admission?.identity.requestId)).toBe(true);
    }
    const starts = page.events.filter((event) => event.name === "tools.call" && event.phase === "start");
    expect(starts.length).toBeGreaterThan(0);
    for (const start of starts) {
      expect(page.events.some((event) => event.name === "tools.call" && event.phase === "end" && event.identity.operationId === start.identity.operationId)).toBe(true);
    }
  });
  it(
    "joins concurrent admissions at the source before worker scheduling",
    async () => {
      const running = await startHarness({ captureContent: false });
      const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };
      expect((await fetch(`${running.baseUrl}/api/diagnostics/policy`, { method: "PUT", headers,
        body: JSON.stringify({ enabled: true }) })).status).toBe(200);
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      await client.wait(await client.send("diagnostic-parallel", "seed"));
      const health = await (await fetch(`${running.baseUrl}/api/diagnostics`, { headers })).json() as { latestSequence: number };
      const runs = await Promise.all([
        client.send("diagnostic-parallel", "hello first"),
        client.send("diagnostic-parallel", "hello second"),
      ]);
      const replies = await Promise.all(runs.map((run) => client.wait(run)));
      expect(replies.every((reply) => reply.text.includes("Echo:"))).toBe(true);
      const response = await fetch(`${running.baseUrl}/api/diagnostics/events?after=${health.latestSequence}&limit=500`, { headers });
      const page = await response.json() as DiagnosticPage;
      const admissions = runs.map((run) => page.events.find((event) => event.name === "http.admission" && event.identity.submissionId === run.submissionId));
      expect(new Set(admissions.map((event) => event?.identity.requestId)).size).toBe(2);
      for (const run of runs) {
        const admission = admissions.find((event) => event?.identity.submissionId === run.submissionId);
        const queued = page.events.find((event) => event.name === "runtime.submission_queued" && event.identity.submissionId === run.submissionId);
        expect(admission).toBeDefined(); expect(queued).toBeDefined();
        expect(queued?.identity).toMatchObject({ requestId: admission?.identity.requestId, invocationId: admission?.identity.operationId });
      }
      const models = page.events.filter((event) => event.name === "execution.model" && event.phase === "start" && event.identity.agentName === "studio");
      expect(models.length).toBeGreaterThan(0);
      for (const model of models) {
        const admission = admissions.find((event) => event?.identity.submissionId === model.identity.submissionId);
        expect(admission).toBeDefined();
        expect(model.identity.requestId).toBe(admission?.identity.requestId);
        expect(model.attributes.stage).toBe("interceptor_step");
      }
    },
    30_000,
  );

  it(
    "records a refused tool boundary without claiming that execution happened",
    async () => {
      const running = await startHarness({ captureContent: false });
      const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };
      expect((await fetch(`${running.baseUrl}/api/diagnostics/policy`, { method: "PUT", headers,
        body: JSON.stringify({ enabled: true }) })).status).toBe(200);
      const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });
      const run = await client.send("diagnostic-denied", "askme please");
      let approvalId: string | undefined;
      await waitUntil(async () => {
        const response = await fetch(`${running.baseUrl}/api/permissions/pending`, { headers });
        const approvals = await response.json() as readonly { id: string }[];
        approvalId = approvals[0]?.id;
        return approvalId !== undefined;
      });
      expect((await fetch(`${running.baseUrl}/api/permissions/pending/${approvalId}`, { method: "POST", headers,
        body: JSON.stringify({ verdict: "deny", duration: "once" }) })).status).toBe(204);
      // This scripted scenario asks again after a refused write. Inspect the
      // refusal itself, then cancel its next ask rather than inventing success.
      await waitUntil(async () => {
        const page = await (await fetch(`${running.baseUrl}/api/diagnostics/events?limit=500`, { headers })).json() as DiagnosticPage;
        return page.events.some((event) => event.name === "runtime.tool" && event.identity.submissionId === run.submissionId && event.outcome === "failed");
      });
      expect(await client.cancel("diagnostic-denied")).toBe(true);
      await expect(client.wait(run)).rejects.toThrow();
      const response = await fetch(`${running.baseUrl}/api/diagnostics/events?limit=500`, { headers });
      const page = await response.json() as DiagnosticPage;
      const events = page.events.filter((event) => event.identity.submissionId === run.submissionId);
      expect(events.find((event) => event.name === "tools.authorize" && event.phase === "end")?.outcome).toBe("failed");
      expect(events.find((event) => event.name === "tools.call" && event.phase === "end")?.outcome).toBe("failed");
      expect(events.some((event) => event.name === "tools.execute")).toBe(false);
      expect(events.some((event) => event.name === "runtime.tool" && event.outcome === "failed")).toBe(true);
      expect(events.every((event) => event.content === undefined)).toBe(true);
    },
    30_000,
  );

  it(
    "emits agent/model/tool span hierarchy and metrics without content by default",
    async () => {
      const running = await startHarness({ captureContent: false });
       const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

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
      expect(tool?.name).toContain("glob");

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
       const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

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
       const client = new FlueHarnessClient({ baseUrl: running.baseUrl, token: running.token });

      const headers = { authorization: `Bearer ${running.token}`, "content-type": "application/json" };
      expect((await fetch(`${running.baseUrl}/api/diagnostics/policy`, { method: "PUT", headers,
        body: JSON.stringify({ enabled: true }) })).status).toBe(200);
      const run = await client.send("otel-cancel", "[slow] please wait");
      await waitUntil(async () => {
        const page = await (await fetch(`${running.baseUrl}/api/diagnostics/events?limit=500`, { headers })).json() as DiagnosticPage;
        return page.events.some((event) => event.name === "execution.model" && event.phase === "start" && event.identity.submissionId === run.submissionId);
      });
      expect(await client.cancel("otel-cancel")).toBe(true);
      await expect(client.wait(run)).rejects.toThrow();

      const evidence = await fetch(`${running.baseUrl}/api/diagnostics/events?limit=500`, { headers });
      const page = await evidence.json() as DiagnosticPage;
      expect(page.events.some((event) => event.name === "http.response" && event.attributes.stage === "agent_abort" && event.identity.conversationId === "otel-cancel")).toBe(true);
      expect(page.events.some((event) => event.name === "runtime.submission_settled" && event.identity.submissionId === run.submissionId && event.outcome === "cancelled")).toBe(true);
      expect(page.events.some((event) => event.name === "runtime.turn" && event.identity.submissionId === run.submissionId && event.outcome === "cancelled")).toBe(true);

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
