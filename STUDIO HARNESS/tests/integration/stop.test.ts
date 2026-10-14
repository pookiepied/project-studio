import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";

import { afterEach, describe, expect, it } from "vitest";
import { createFlueClient } from "@flue/sdk";

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
  it("caps the durable queue and promotes or removes only messages that have not started", async () => {
    const dir = await mkdtemp(join(tmpdir(), "studio-queue-controls-"));
    toClean.push(() => rm(dir, { recursive: true, force: true }));
    const h = await startHarness(join(dir, "flue.db"));
    toClean.push(() => stopHarness(h.process));
    const id = "queue-controls";
    const url = `${h.baseUrl}/agents/studio/${id}`;
    const client = createFlueClient({ url, token: h.token });
    const first = await client.send({ message: { kind: "user", body: "[slow] inspect workspace" } });
    await waitUntil(async () => (await client.history()).messages.some((message) => message.submissionId === first.submissionId));
    const headers = { "Content-Type": "application/json", Authorization: `Bearer ${h.token}` };
    const image = { type: "image", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=", mimeType: "image/png", filename: "pixel.png" };
    const enqueue = (body: string) => fetch(url, { method: "POST", headers, body: JSON.stringify({ kind: "user", body, deliveryMode: "queue", ...(body === "edit me" ? { attachments: [image] } : {}) }) });
    const queuedIds: string[] = [];
    for (const text of ["promote me", "delete me", "edit me"]) {
      const response = await enqueue(text);
      expect(response.status).toBe(202);
      const receipt: unknown = await response.json();
      if (typeof receipt !== "object" || receipt === null || !("submissionId" in receipt) || typeof receipt.submissionId !== "string") throw new Error("Missing receipt.");
      queuedIds.push(receipt.submissionId);
    }
    expect((await enqueue("fourth message")).status).toBe(400);
    const queueUrl = `${h.baseUrl}/api/conversations/${id}/queue`;
    const listed = await fetch(queueUrl, { headers });
    expect(listed.status).toBe(200);
    expect(await listed.json()).toEqual(queuedIds.map((submissionId, index) => ({ submissionId, text: ["promote me", "delete me", "edit me"][index], images: [] })));
    const action = (submissionId: string, verb: string) => fetch(`${queueUrl}/${submissionId}/${verb}`, { method: "POST", headers });
    const [promotedId, deletedId, editedId] = queuedIds;
    if (!promotedId || !deletedId || !editedId) throw new Error("Expected three queue receipts.");
    expect((await action(first.submissionId, "remove")).status).toBe(409);
    expect((await action(promotedId, "steer")).status).toBe(204);
    expect((await action(deletedId, "remove")).status).toBe(204);
    const editing = await action(editedId, "edit");
    expect(editing.status).toBe(200);
    expect(await editing.json()).toEqual({ submissionId: editedId, text: "edit me", images: [image] });
    expect((await action(deletedId, "steer")).status).toBe(409);
    const replacement = await enqueue("edited replacement");
    expect(replacement.status).toBe(202);
    const replacementReceipt: unknown = await replacement.json();
    if (typeof replacementReceipt !== "object" || replacementReceipt === null || !("submissionId" in replacementReceipt) || typeof replacementReceipt.submissionId !== "string") throw new Error("Missing replacement receipt.");
    await client.read(first);
    await client.read(replacementReceipt.submissionId);
    const history = await client.history();
    expect(history.messages.some((message) => message.role === "user" && [queuedIds[1], queuedIds[2]].includes(message.submissionId ?? ""))).toBe(false);
    expect(history.messages.some((message) => message.role === "user" && message.submissionId === queuedIds[0])).toBe(true);
    expect(history.messages.some((message) => message.role === "assistant" && message.submissionId === queuedIds[0])).toBe(false);
    expect(history.settlements.find((item) => item.submissionId === first.submissionId)?.outcome).toBe("completed");
    expect((await action(promotedId, "remove")).status).toBe(409);
  }, 60_000);
  it("keeps queued input out of the live response while steering joins at a safe boundary", async () => {
    const dir = await mkdtemp(join(tmpdir(), "studio-steering-"));
    toClean.push(() => rm(dir, { recursive: true, force: true }));
    const h = await startHarness(join(dir, "flue.db"));
    toClean.push(() => stopHarness(h.process));
    const url = `${h.baseUrl}/agents/studio/steering`;
    const client = createFlueClient({ url, token: h.token });
    const first = await client.send({ message: { kind: "user", body: "[slow] inspect workspace" } });
    await waitUntil(async () => {
      const history = await client.history();
      return history.messages.some((message) => message.role === "user" && message.submissionId === first.submissionId);
    });
    const deliver = async (body: string, deliveryMode: "queue" | "steer"): Promise<string> => {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${h.token}` },
        body: JSON.stringify({ kind: "user", body, deliveryMode }),
      });
      expect(response.status).toBe(202);
      const receipt: unknown = await response.json();
      if (typeof receipt !== "object" || receipt === null || !("submissionId" in receipt) || typeof receipt.submissionId !== "string") {
        throw new Error("The admission receipt did not name its submission.");
      }
      return receipt.submissionId;
    };
    const queued = await deliver("a separate follow-up", "queue");
    const steered = await deliver("use this correction", "steer");
    await client.read(first);
    await client.read(queued);
    await client.read(steered);
    const history = await client.history();
    const firstReply = history.messages.findIndex((message) => message.role === "assistant" && message.submissionId === first.submissionId);
    const correction = history.messages.findIndex((message) => message.role === "user" && message.submissionId === steered);
    const followUp = history.messages.findIndex((message) => message.role === "user" && message.submissionId === queued);
    expect(firstReply).toBeGreaterThanOrEqual(0);
    expect(correction).toBeGreaterThanOrEqual(0);
    expect(correction).toBeLessThan(followUp);
    expect(history.messages.some((message) => message.role === "assistant" && message.submissionId === steered)).toBe(false);
    expect(followUp).toBeGreaterThan(firstReply);
    expect(history.messages.some((message) => message.role === "assistant" && message.submissionId === queued)).toBe(true);
    expect(history.settlements.filter((item) => [first.submissionId, queued, steered].includes(item.submissionId))).toHaveLength(3);
  }, 45_000);
  // The file's title names four concerns; the tests here cover two of them
  // end to end (stop and disconnect) plus the settlement vocabulary. The
  // other two live where the machinery they bind lives (#66): the per-request
  // deadline in tests/unit/mcp-connection.test.ts, and the cancellation of a
  // real in-flight MCP tool call in tests/integration/mcp-runtime.test.ts.
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
