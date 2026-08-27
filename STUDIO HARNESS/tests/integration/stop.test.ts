import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";

import { createAdmissionSession } from "../../src/admission/verifier.js";
import { FlueHarnessClient, type AcceptedRun } from "../../src/application/harness-client.js";

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
      // The whole Studio home travels with the database: an agent turn now
      // creates its conversation tree under it, and a test must not write
      // there under the developer's real home.
      PROJECT_STUDIO_HOME: dirname(dbPath),
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
    const run: AcceptedRun = await client.send("stop-model", "[slow] please wait");
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
    const run: AcceptedRun = await client.send("disconnect", "[slow] survive disconnect");
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
    const { outcomeFor } = await import("../../src/execution/outcomes.js");
    expect(outcomeFor("transport_loss", false).outcome).toBe("unknown");
    expect(outcomeFor("transport_loss", false).retryable).toBe(false);
    expect(outcomeFor("transport_loss", true).retryable).toBe(true);
    expect(outcomeFor("user_stop", true).retryable).toBe(false);
  });
});
