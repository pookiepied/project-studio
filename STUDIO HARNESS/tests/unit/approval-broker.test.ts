import { describe, expect, it } from "vitest";

import { ALL_ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { PermissionApprovalBroker } from "../../src/application/approval-broker.js";
import type { PermissionDecision, PermissionRequest } from "../../src/permissions/policy.js";

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
