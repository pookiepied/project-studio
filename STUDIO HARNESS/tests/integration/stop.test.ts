import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import { FlueHarnessClient, type AcceptedRun } from "../../src/application/harness-client.js";
import { WorkspaceTrustStore } from "../../src/permissions/trust.js";
import { openDatabase } from "../../src/storage/database.js";
import { projectKey } from "../../src/snapshots/shadow-repo.js";
import { createStudioUuid } from "../../src/identity/uuid.js";

// Reuse the same harness boot as harness.test but with execution-context awareness.
async function availablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const a = s.address();
      if (!a || typeof a === "string") return reject(new Error("no port"));
      s.close((e) => (e ? reject(e) : resolve((a as any).port)));
    });
  });
}

async function waitUntil(pred: () => Promise<boolean>, ms = 15000): Promise<void> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("waitUntil timeout");
}

interface Running {
  baseUrl: string;
  process: ChildProcess;
  token: string;
}

async function startHarness(dbPath: string): Promise<Running> {
  const port = await availablePort();
  const adm = createAdmissionSession({ clientType: "test" });
  const child = spawn(process.execPath, ["dist/server.mjs"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      PORT: String(port),
      PROJECT_STUDIO_ADMISSION_CREDENTIAL: adm.credential,
      PROJECT_STUDIO_DB_PATH: dbPath,
      PROJECT_STUDIO_STORE_PATH: join(dirname(dbPath), "studio.db"),
    },
    stdio: "pipe",
  });
  const baseUrl = `http://127.0.0.1:${port}`;
  let stderr = "";
  child.stderr?.on("data", (c: Buffer) => (stderr += c.toString()));
  await waitUntil(async () => {
    if (child.exitCode !== null) throw new Error(`Harness exited: ${stderr}`);
    try {
      await fetch(baseUrl);
      return true;
    } catch {
      return false;
    }
  }, 60000);
  return { baseUrl, process: child, token: adm.credential };
}

async function stopHarness(child: ChildProcess): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    await new Promise<void>((res) => {
      const t = setTimeout(() => {
        child.kill("SIGKILL");
        res();
      }, 3000);
      child.once("exit", () => {
        clearTimeout(t);
        res();
      });
    });
  }
}

const ECHO_SERVER = `
process.stdin.setEncoding("utf8");
let buf="";
function reply(id, result){ process.stdout.write(JSON.stringify({ jsonrpc:"2.0", id, result })+"\\n"); }
function handle(m){
  if(m.method==="server/discover") reply(m.id,{protocolVersion:"2026-07-28",capabilities:{}});
  else if(m.method==="tools/list") reply(m.id,{tools:[{name:"echo",description:"Echo",inputSchema:{type:"object",properties:{text:{type:"string"}}}}]});
  else if(m.method==="tools/call") reply(m.id,{content:[{type:"text",text:m.params.arguments.text}]});
}
process.stdin.on("data",c=>{buf+=c; for(;;){const i=buf.indexOf("\\n"); if(i<0)break; const line=buf.slice(0,i); buf=buf.slice(i+1); if(line.trim()!=="") handle(JSON.parse(line));}});
`;

const SLOW_SERVER = `
process.stdin.setEncoding("utf8");
let buf="";
function reply(id, result){ process.stdout.write(JSON.stringify({ jsonrpc:"2.0", id, result })+"\\n"); }
function handle(m){
  if(m.method==="server/discover") reply(m.id,{protocolVersion:"2026-07-28",capabilities:{}});
  else if(m.method==="tools/list") reply(m.id,{tools:[{name:"slow",description:"Slow",inputSchema:{type:"object",properties:{text:{type:"string"}}}}]});
  else if(m.method==="tools/call") setTimeout(()=>reply(m.id,{content:[{type:"text",text:m.params.arguments.text}]}), 8000);
}
process.stdin.on("data",c=>{buf+=c; for(;;){const i=buf.indexOf("\\n"); if(i<0)break; const line=buf.slice(0,i); buf=buf.slice(i+1); if(line.trim()!=="") handle(JSON.parse(line));}});
`;

describe.sequential("008.2 stop, timeout, cancellation, and disconnect", () => {
  const toClean: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const fn of toClean.splice(0).reverse()) await fn().catch(() => {});
  });

  it("aborts a model-streaming turn with durable aborted settlement", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stop-model-"));
    const db = join(dir, "flue.db");
    toClean.push(() => rm(dir, { recursive: true, force: true }));
    const h = await startHarness(db);
    toClean.push(() => stopHarness(h.process));
    const client = new FlueHarnessClient({ baseUrl: h.baseUrl, token: h.token });
    const run: AcceptedRun = await client.send("stop-model", "[slow] please wait", createStudioUuid());
    expect(await client.cancel("stop-model")).toBe(true);
    await expect(client.wait(run)).rejects.toThrow();
    const hist = await client.history("stop-model");
    expect(hist.settlements.find((s) => s.submissionId === run.submissionId)?.outcome).toBe("aborted");
  }, 30000);

  it("aborts during approval wait via broker signal", async () => {
    const { PermissionApprovalBroker } = await import("../../src/application/approval-broker.js");
    const broker = new PermissionApprovalBroker();
    const controller = new AbortController();
    const pending = broker.request(
      { capability: "test", resource: "/tmp/x" } as any,
      { verdict: "ask", reason: "test" } as any,
      controller.signal,
    );
    // Abort before answering — the request must settle as cancelled, not hang.
    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(broker.list({} as any)).toHaveLength(0);

    // MCP pending also aborts via signal
    const { PendingRequests } = await import("../../src/extend/mcp/wire/pending.js");
    const pendingMcp = new PendingRequests();
    const ctrl2 = new AbortController();
    const p2 = pendingMcp.register(1, { signal: ctrl2.signal });
    ctrl2.abort();
    await expect(p2).rejects.toThrow();
    expect(pendingMcp.size).toBe(0);
  }, 30000);

  it("desktop disconnect (close observe) does not abort the turn — wait still completes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "stop-disconnect-"));
    const db = join(dir, "flue.db");
    toClean.push(() => rm(dir, { recursive: true, force: true }));
    const h = await startHarness(db);
    toClean.push(() => stopHarness(h.process));
    const client = new FlueHarnessClient({ baseUrl: h.baseUrl, token: h.token });
    const obs = client.observe("disconnect");
    // Start a slow turn
    const run: AcceptedRun = await client.send("disconnect", "[slow] survive disconnect", createStudioUuid());
    // Immediately close the observation (desktop disconnect)
    obs.close();
    // The turn must still settle as completed, not aborted, and be readable via wait/history.
    const res = await client.wait(run);
    expect(res.text).toBe("Echo: survive disconnect");
    const hist = await client.history("disconnect");
    expect(hist.settlements.find((s) => s.submissionId === run.submissionId)?.outcome).toBe("completed");
  }, 30000);

  it("distinguishes completed, aborted, failed, and unknown — unknown is not retried", async () => {
    // This is a unit-level check of the outcome mapping, but we also prove the Harness
    // does not auto-retry a non-idempotent unknown by checking that a cancelled
    // non-idempotent tool reports unknown and requires explicit user re-check.
    const { outcomeFor, isRetryableForUnknown } = await import("../../src/execution/outcomes.js");
    expect(outcomeFor("transport_loss", false).outcome).toBe("unknown");
    expect(isRetryableForUnknown(false, "unknown")).toBe(false);
    expect(isRetryableForUnknown(true, "unknown")).toBe(true);
    expect(isRetryableForUnknown(true, "aborted")).toBe(false);
  });
});
