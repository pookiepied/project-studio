import { describe, expect, it } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { PermissionDecision, PermissionRequest } from "../../src/permissions/policy.js";
import { PendingApprovalStore } from "../../src/permissions/pending-approvals.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

const AUTH_CONTEXT = {
  clientId: "test-client",
  clientType: "test",
  sessionId: "test-session",
  scopes: ALL_ADMISSION_SCOPES,
} as const;

const REQUEST = {
  capability: {
    id: { namespace: "mcp:example", name: "search" },
    title: "search",
    description: "Search documents",
    effects: ["network"],
    provenance: { origin: "mcp", sourceId: "example", author: "third-party" },
    idempotent: false,
  },
  scope: { agentId: "agent", conversationId: "conversation", projectId: "project" },
  resource: undefined,
  scopes: [{ id: "this-capability", label: "This tool", detail: "Every use", pattern: undefined }],
} satisfies PermissionRequest;

const DECISION = {
  verdict: "ask",
  source: "policy",
  reason: "Review it.",
  grantId: undefined,
} satisfies PermissionDecision;

describe("permission approval broker", () => {
  it("holds a request until the person answers it", async () => {
    const broker = new PermissionApprovalBroker();
    const pending = broker.request(REQUEST, DECISION);

    const [entry] = broker.list(AUTH_CONTEXT);
    expect(entry?.request.capability.id.name).toBe("search");
    expect(broker.answer(entry?.id ?? "missing", { verdict: "allow", duration: "always" }, AUTH_CONTEXT)).toBe(true);
    await expect(pending).resolves.toEqual({ verdict: "allow", duration: "always" });
    expect(broker.list(AUTH_CONTEXT)).toEqual([]);
  });

  it("does not answer an unknown request", () => {
    const broker = new PermissionApprovalBroker();
    expect(broker.answer("missing", { verdict: "deny", duration: "once" }, AUTH_CONTEXT)).toBe(false);
  });

  it("removes a pending request when its caller aborts", async () => {
    const broker = new PermissionApprovalBroker();
    const controller = new AbortController();
    const pending = broker.request(REQUEST, DECISION, controller.signal);

    expect(broker.list(AUTH_CONTEXT)).toHaveLength(1);
    controller.abort();

    await expect(pending).resolves.toBeUndefined();
    expect(broker.list(AUTH_CONTEXT)).toEqual([]);
    expect(broker.answer("missing", { verdict: "allow", duration: "always" }, AUTH_CONTEXT)).toBe(false);
  });

  it("does not create a pending request for an already-aborted signal", async () => {
    const broker = new PermissionApprovalBroker();
    const controller = new AbortController();
    controller.abort();

    await expect(broker.request(REQUEST, DECISION, controller.signal)).resolves.toBeUndefined();
    expect(broker.list(AUTH_CONTEXT)).toEqual([]);
  });
});

describe("an approval settles once (ADR 0050 §3.3)", () => {
  it("refuses a second answer to an approval already answered, and the first stands", async () => {
    const database = openDatabase({ path: ":memory:" });
    const store = new PendingApprovalStore(database);
    const broker = new PermissionApprovalBroker({ store });

    const pending = broker.request(REQUEST, DECISION);
    const id = broker.list(AUTH_CONTEXT)[0]?.id ?? "";

    // Two windows racing on one prompt: the answer that arrives first wins,
    // and the loser is told there is nothing left to settle.
    expect(broker.answer(id, { verdict: "allow", duration: "always" }, AUTH_CONTEXT)).toBe(true);
    expect(broker.answer(id, { verdict: "deny", duration: "once" }, AUTH_CONTEXT)).toBe(false);

    await expect(pending).resolves.toEqual({ verdict: "allow", duration: "always" });
    expect(broker.list(AUTH_CONTEXT)).toEqual([]);

    // The loser's refusal is not a politeness - it is the durable row being
    // already gone. The settle is a DELETE guarded by the row existing: had
    // the row survived, the inherited-row branch below would have taken the
    // second answer too and both windows would have been told theirs landed.
    expect(store.list()).toEqual([]);

    database.close();
  });

  it("lets only the first of two windows answer an inherited row", () => {
    const database = openDatabase({ path: ":memory:" });
    const before = new PermissionApprovalBroker({
      store: new PendingApprovalStore(database),
    });
    void before.request(REQUEST, DECISION);

    // Two processes over one durable queue - the restart shape, and the
    // shape two devices are in. Each sees the row; exactly one answer can
    // remove it, because removing it IS the guard the second answer fails.
    const left = new PermissionApprovalBroker({ store: new PendingApprovalStore(database) });
    const right = new PermissionApprovalBroker({ store: new PendingApprovalStore(database) });
    const id = left.list(AUTH_CONTEXT)[0]?.id ?? "";

    expect(left.answer(id, { verdict: "deny", duration: "once" }, AUTH_CONTEXT)).toBe(true);
    expect(right.answer(id, { verdict: "allow", duration: "always" }, AUTH_CONTEXT)).toBe(false);
    expect(left.list(AUTH_CONTEXT)).toEqual([]);

    database.close();
  });
});

describe("permission approval durability (ADR 0036)", () => {
  function freshDatabase(): StudioDatabase {
    return openDatabase({ path: ":memory:" });
  }

  it("survives a restart: a question asked by a dead process is still queued", () => {
    const database = freshDatabase();

    // The process that asked. It parks a caller on a promise and exits.
    const before = new PermissionApprovalBroker({
      store: new PendingApprovalStore(database),
    });
    void before.request(REQUEST, DECISION);

    // A new process over the same database — nothing in memory carries over.
    const after = new PermissionApprovalBroker({
      store: new PendingApprovalStore(database),
    });

    const pending = after.list(AUTH_CONTEXT);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.request.capability.id).toEqual(REQUEST.capability.id);
    expect(pending[0]?.decision.reason).toBe(DECISION.reason);

    database.close();
  });

  it("removes an inherited question once it is answered", () => {
    const database = freshDatabase();
    const before = new PermissionApprovalBroker({
      store: new PendingApprovalStore(database),
    });
    void before.request(REQUEST, DECISION);

    const after = new PermissionApprovalBroker({
      store: new PendingApprovalStore(database),
    });
    const id = after.list(AUTH_CONTEXT)[0]?.id ?? "";

    // There is no live waiter to resolve — that run died with its process —
    // but the question is genuinely answered and must leave the queue.
    expect(after.answer(id, { verdict: "allow", duration: "once" }, AUTH_CONTEXT)).toBe(true);
    expect(after.list(AUTH_CONTEXT)).toEqual([]);

    database.close();
  });

  it("clears the durable row when the asking process answers normally", async () => {
    const database = freshDatabase();
    const store = new PendingApprovalStore(database);
    const broker = new PermissionApprovalBroker({ store });

    const pending = broker.request(REQUEST, DECISION);
    const id = broker.list(AUTH_CONTEXT)[0]?.id ?? "";
    expect(store.list()).toHaveLength(1);

    broker.answer(id, { verdict: "allow", duration: "once" }, AUTH_CONTEXT);
    await expect(pending).resolves.toEqual({ verdict: "allow", duration: "once" });
    // Left behind, this would be re-asked forever after a restart.
    expect(store.list()).toEqual([]);

    database.close();
  });

  it("clears the durable row when the caller aborts", async () => {
    const database = freshDatabase();
    const store = new PendingApprovalStore(database);
    const broker = new PermissionApprovalBroker({ store });
    const controller = new AbortController();

    const pending = broker.request(REQUEST, DECISION, controller.signal);
    expect(store.list()).toHaveLength(1);

    controller.abort();
    await expect(pending).resolves.toBeUndefined();
    expect(store.list()).toEqual([]);

    database.close();
  });
});
