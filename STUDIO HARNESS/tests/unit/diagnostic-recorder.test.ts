import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { DiagnosticRecorder, diagnosticRecorder } from "../../src/observability/recorder.js";
import { diagnosticJsonContent, diagnosticProjectedContent, diagnosticValue, serializeDiagnosticValue } from "../../src/observability/diagnostic-value.js";
import { observeOperation } from "../../src/observability/operation.js";
import { createRootExecutionContext, createRetryExecutionContext, currentExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";
import { invocationFor, rememberInvocation } from "../../src/observability/invocations.js";
import { createDiagnosticRoutes } from "../../src/transport/http/routes/diagnostics.js";
import { createAdmissionMiddleware, requireAdmissionScope, type AdmissionEnv } from "../../src/transport/http/middleware/admission.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";

afterEach(() => diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] }));

describe("bounded diagnostic recording", () => {
  it("captures non-enumerable error details and labels inaccessible stacks without invoking getters", () => {
    const cause = new Error("root failure");
    const failure = new TypeError("outer failure", { cause });
    Object.defineProperty(failure, "stack", { value: "fixture stack" });
    const captured = serializeDiagnosticValue(failure);
    expect(captured.value).toMatchObject({ name: "TypeError", message: "outer failure", stack: "fixture stack",
      cause: { name: "Error", message: "root failure" } });
    let reads = 0;
    Object.defineProperty(cause, "stack", { configurable: true, get() { reads++; throw new Error("getter must not run"); } });
    const omitted = serializeDiagnosticValue(cause);
    expect(omitted.value).toMatchObject({ message: "root failure", stack: "[accessor omitted]" });
    expect(omitted.truncated).toBe(true);
    expect(reads).toBe(0);
  });
  it("processes serialized source frames within the input budget and reports oversized frames without partial secrets", () => {
    expect(diagnosticValue(diagnosticJsonContent('{"authToken":"opaque","message":"hello"}'))).toEqual({
      authToken: "[REDACTED]", message: "hello",
    });
    const oversized = diagnosticJsonContent(`{"data":"${"private-value".repeat(100_000)}"}`);
    expect(serializeDiagnosticValue(oversized)).toEqual({ value: "[serialized content omitted: capture budget]", truncated: true });
    expect(serializeDiagnosticValue(diagnosticJsonContent('{"broken"'))).toEqual({ value: "[invalid serialized content]", truncated: true });
    const argumentFrame = JSON.stringify({ function: { name: "configure", arguments: '{"authToken":"opaque","count":2}' } });
    expect(diagnosticValue(diagnosticJsonContent(argumentFrame))).toEqual({
      function: { name: "configure", arguments: '{"authToken":"[REDACTED]","count":2}' },
    });
    const partial = serializeDiagnosticValue(diagnosticJsonContent('{"partial_json":"opaque-credential-fragment"}'));
    expect(partial.value).toEqual({ partial_json: "[structured content omitted: argument fragment]" });
    const nameless = serializeDiagnosticValue(diagnosticJsonContent(JSON.stringify({ function: {
      arguments: '{"password":"opaque-value"}',
    } })));
    expect(nameless.value).toEqual({ function: { arguments: '{"password":"[REDACTED]"}' } });
    const fragment = serializeDiagnosticValue(diagnosticJsonContent(JSON.stringify({ function: { arguments: '"password":"opaque-fragment"' } })));
    expect(fragment.value).toEqual({ function: { arguments: "[structured content omitted: incomplete or invalid JSON]" } });
    expect(JSON.stringify([nameless, fragment])).not.toContain("opaque-");
    const scalar = serializeDiagnosticValue(diagnosticJsonContent(JSON.stringify({ function: { arguments: '"opaque-scalar-fragment"' } })));
    expect(scalar.value).toEqual({ function: { arguments: "[structured content omitted: incomplete or invalid JSON]" } });
    expect(partial.truncated).toBe(true);
  });
  it("does not inspect payloads or create events when disabled", () => {
    const recorder = new DiagnosticRecorder();
    const payload = new Proxy({}, { ownKeys() { throw new Error("must not inspect"); } });
    recorder.record({ name: "test.disabled", phase: "start", content: diagnosticProjectedContent(payload, []) });
    expect(recorder.health().latestSequence).toBe(0);
    expect(recorder.read().events).toEqual([]);
  });

  it("captures bodies only with content enabled and an explicit conversation scope", () => {
    const recorder = new DiagnosticRecorder();
    recorder.configure({ enabled: true, captureContent: true, conversations: ["cnv_selected"] });
    for (const conversationId of ["cnv_selected", "cnv_other"]) recorder.record({
      name: "test.content", phase: "progress", identity: { conversationId }, content: diagnosticJsonContent('{"password":"never-store-this","text":"hello"}'),
    });
    const [selected, other] = recorder.read().events;
    expect(selected?.content).toEqual({ password: "[REDACTED]", text: "hello" });
    expect(other?.content).toBeUndefined();
    expect(other?.contentState).toBe("out_of_scope");
    recorder.configure({ captureContent: false });
    expect(recorder.read().events).toEqual([]);
    expect(recorder.read().gap).toBe(true);
  });

  it("bounds retention and reports sequence gaps, boot changes and detached pages", () => {
    const recorder = new DiagnosticRecorder();
    recorder.configure({ enabled: true, maxEvents: 2 });
    for (let at = 0; at < 3; at++) recorder.record({ name: "test.bound", phase: "progress", attributes: { at } });
    const page = recorder.read(0, 1);
    expect(page.gap).toBe(true);
    expect(page.events[0]?.sequence).toBe(2);
    expect(page.nextSequence).toBe(2);
    expect(page.health.evictedEvents).toBe(1);
    expect(recorder.read(2).events[0]?.sequence).toBe(3);
    expect(recorder.read(3).gap).toBe(false);
    expect(recorder.read(3, 100, "old-boot").gap).toBe(true);
    (page.events[0]!.attributes as Record<string, unknown>).at = 999;
    expect(recorder.read().events[0]?.attributes.at).toBe(1);
    recorder.configure({ enabled: false });
    recorder.record({ name: "test.stopped", phase: "start" });
    expect(recorder.read().events).toHaveLength(2);
  });

  it("caps bytes, marks truncation, and never invokes serialization hooks", () => {
    let called = 0;
    const hostile = { get secret() { called++; throw new Error("getter"); }, toJSON() { called++; throw new Error("toJSON"); }, big: "x".repeat(100_000) };
    const recorder = new DiagnosticRecorder();
    recorder.configure({ enabled: true, captureContent: true, conversations: ["cnv"], maxBytes: 4096, maxEventBytes: 2048 });
    recorder.record({ name: "test.large", phase: "progress", identity: { conversationId: "cnv" }, content: diagnosticProjectedContent(hostile, ["secret", "toJSON", "big"]) });
    expect(called).toBe(0);
    expect(recorder.read().events[0]?.contentState).toBe("truncated");
    expect(recorder.health().retainedBytes).toBeLessThanOrEqual(4096);
    const circular: Record<string, unknown> = {}; circular.self = circular;
    expect(diagnosticValue(circular)).toEqual({ self: "[circular]" });
    expect(diagnosticValue(new Proxy({}, { ownKeys() { throw new Error("proxy must not be enumerated"); } }))).toBe("[proxy omitted]");
  });

  it("redacts token variants and private keys even when the closing delimiter is beyond the capture budget", () => {
    const pem = `-----BEGIN PRIVATE KEY-----\n${"A".repeat(13_000)}\n-----END PRIVATE KEY-----`;
    expect(diagnosticValue(pem)).not.toContain("AAAA");
    expect(diagnosticValue({ sessionToken: "opaque", authToken: "opaque", id_token: "opaque", totalTokens: 42, maxTokens: 100 })).toEqual({
      sessionToken: "[REDACTED]", authToken: "[REDACTED]", id_token: "[REDACTED]", totalTokens: 42, maxTokens: 100,
    });
    expect(diagnosticValue(diagnosticJsonContent('{"usage":{"input_tokens":4,"total_tokens":7,"candidatesTokenCount":3},"authToken":42,"token":11}'))).toEqual({
      usage: { input_tokens: 4, total_tokens: 7, candidatesTokenCount: 3 }, authToken: "[REDACTED]", token: "[REDACTED]",
    });
  });
});

describe("operation identity and result preservation", () => {
  it("preserves returned tool errors and distinguishes them from thrown failures without invoking accessors", async () => {
    diagnosticRecorder.configure({ enabled: true });
    diagnosticRecorder.clear();
    const returned = { isError: true, content: [{ type: "text", text: "tool reported an error" }] };
    expect(await observeOperation("tool", "test.returned_error", async () => returned)).toBe(returned);
    expect(diagnosticRecorder.read().events.at(-1)).toMatchObject({ outcome: "failed", attributes: { returnedError: true } });
    let reads = 0;
    const accessor = { get isError() { reads++; return true; } };
    expect(await observeOperation("tool", "test.accessor", async () => accessor)).toBe(accessor);
    expect(diagnosticRecorder.read().events.at(-1)).toMatchObject({ outcome: "unknown", attributes: { resultErrorUnavailable: true } });
    expect(reads).toBe(0);
  });
  it("links concurrent operations without mixing request families", async () => {
    diagnosticRecorder.configure({ enabled: true });
    const roots = [createRootExecutionContext(), createRootExecutionContext()];
    await Promise.all(roots.map((root) => runWithExecutionContext(root, () =>
      observeOperation("tool", "test.operation", async () => { await Promise.resolve(); return root.requestId; }))));
    for (const root of roots) {
      const events = diagnosticRecorder.read().events.filter((event) => event.identity.requestId === root.requestId);
      expect(events).toHaveLength(2);
      expect(events[0]?.identity.parentOperationId).toBe(root.operationId);
      expect(events[0]?.identity.operationId).toBe(events[1]?.identity.operationId);
      expect(events[1]?.outcome).toBe("completed");
    }
    const retry = createRetryExecutionContext(roots[0]!);
    expect(retry.operationId).toBe(roots[0]!.operationId);
    expect(retry.attemptId).not.toBe(roots[0]!.attemptId);
  });

  it("preserves returned objects and the exact thrown rejection", async () => {
    diagnosticRecorder.configure({ enabled: true });
    const value = new Proxy({}, { ownKeys() { throw new Error("do not inspect result"); } });
    expect(await observeOperation("tool", "test.result", () => Promise.resolve(value))).toBe(value);
    const failure = new Error("failure");
    await expect(observeOperation("tool", "test.failure", () => Promise.reject(failure))).rejects.toBe(failure);
    expect(diagnosticRecorder.read().events.at(-1)?.outcome).toBe("failed");
  });
});

describe("diagnostic control boundary", () => {
  it("links an abort request to its conversation without replacing the invocation being cancelled", async () => {
    diagnosticRecorder.configure({ enabled: true });
    diagnosticRecorder.clear();
    const original = createRootExecutionContext();
    rememberInvocation("studio", "cnv_abort_index", original, "cnv_abort_index")("abort-index-submission");
    const session = createAdmissionSession();
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.post("/agents/studio/cnv_abort_index/abort", (context) => context.json({ aborted: true }));
    const response = await app.request("/agents/studio/cnv_abort_index/abort", { method: "POST",
      headers: { authorization: `Bearer ${session.credential}` } });
    expect(response.status).toBe(200);
    const events = diagnosticRecorder.read().events;
    expect(events).toHaveLength(2);
    expect(events.every((event) => event.identity.conversationId === "cnv_abort_index" &&
      event.identity.agentInstanceId === "cnv_abort_index" && event.attributes.stage === "agent_abort")).toBe(true);
    expect(events[0]?.identity.requestId).not.toBe(original.requestId);
    expect(invocationFor("studio", "cnv_abort_index")?.execution).toBe(original);
  });
  it.each(["studio", "future-agent"])("indexes direct %s invocations before route execution and links the actual receipt", async (agentName) => {
    diagnosticRecorder.configure({ enabled: true });
    const session = createAdmissionSession();
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    const request = createRootExecutionContext().requestId;
    const submissionId = `direct-index-${agentName}`;
    app.post(`/agents/${agentName}/cnv_direct_index`, (context) => {
      expect(invocationFor(agentName, "cnv_direct_index")?.execution).toBe(currentExecutionContext());
      return context.json({ submissionId });
    });
    const response = await app.request(`/agents/${agentName}/cnv_direct_index`, { method: "POST",
      headers: { authorization: `Bearer ${session.credential}`, "X-Project-Studio-Request-Id": request } });
    expect(response.status).toBe(200);
    expect(invocationFor(agentName, "cnv_direct_index", submissionId)?.execution).toMatchObject({
      requestId: request, observationCaptureId: diagnosticRecorder.captureId,
    });
    expect(invocationFor(agentName, "cnv_direct_index", submissionId)?.conversationId).toBe(agentName === "studio" ? "cnv_direct_index" : undefined);
  });
  it.each(["clear", "enable", "restart"] as const)("fences an HTTP receipt and completion after capture %s", async (change) => {
    diagnosticRecorder.configure({ enabled: change !== "enable" });
    diagnosticRecorder.clear();
    const session = createAdmissionSession();
    const app = new Hono<AdmissionEnv>();
    let enter: (() => void) | undefined;
    let release: (() => void) | undefined;
    const entered = new Promise<void>((resolve) => { enter = resolve; });
    const pending = new Promise<void>((resolve) => { release = resolve; });
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.post("/agents/studio/cnv_fixture", async (context) => {
      enter?.(); await pending;
      return context.json({ submissionId: "sub_fixture" });
    });
    const request = app.request("/agents/studio/cnv_fixture", { method: "POST",
      headers: { authorization: `Bearer ${session.credential}` } });
    await entered;
    if (change === "clear") diagnosticRecorder.clear();
    else {
      diagnosticRecorder.configure({ enabled: false });
      diagnosticRecorder.clear();
      diagnosticRecorder.configure({ enabled: true });
    }
    release?.();
    expect((await request).status).toBe(200);
    expect(diagnosticRecorder.read().events).toEqual([]);
  });
  function appFor(scopes: typeof ADMISSION_SCOPES[keyof typeof ADMISSION_SCOPES][]) {
    const session = createAdmissionSession({ scopes });
    const recorder = new DiagnosticRecorder();
    const app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.use("/api/diagnostics/*", requireAdmissionScope(ADMISSION_SCOPES.DIAGNOSTIC));
    app.route("/api/diagnostics", createDiagnosticRoutes(recorder));
    return { app, recorder, headers: { authorization: `Bearer ${session.credential}` } };
  }

  it("requires admission and diagnostic scope even for health and policy", async () => {
    const { app, headers } = appFor([]);
    expect((await app.request("/api/diagnostics")).status).toBe(401);
    expect((await app.request("/api/diagnostics", { headers })).status).toBe(403);
    expect((await app.request("/api/diagnostics/policy", { method: "PUT", headers, body: '{"enabled":true}' })).status).toBe(403);
  });

  it("validates controls and cursors, exposes status, and deletes retained evidence", async () => {
    const { app, recorder, headers } = appFor([ADMISSION_SCOPES.DIAGNOSTIC]);
    const changed = await app.request("/api/diagnostics/policy", { method: "PUT", headers, body: '{"enabled":true,"maxEvents":2}' });
    expect(changed.status).toBe(200);
    expect(changed.headers.get("cache-control")).toBe("no-store");
    recorder.record({ name: "test.api", phase: "start" });
    const page = await app.request("/api/diagnostics/events", { headers });
    expect((await page.json()).events).toHaveLength(1);
    expect((await app.request("/api/diagnostics/events?after=-1", { headers })).status).toBe(400);
    expect((await app.request("/api/diagnostics/policy", { method: "PUT", headers, body: '{"maxEvents":0}' })).status).toBe(400);
    expect((await app.request("/api/diagnostics/events", { method: "DELETE", headers })).status).toBe(204);
    expect(recorder.health().retainedEvents).toBe(0);
  });

  it("rejects an old window's consent update after another window changes capture", async () => {
    const { app, recorder, headers } = appFor([ADMISSION_SCOPES.DIAGNOSTIC]);
    const expectedCaptureId = recorder.captureId;
    recorder.configure({ enabled: true });
    const response = await app.request("/api/diagnostics/policy", { method: "PUT", headers,
      body: JSON.stringify({ enabled: false, expectedCaptureId }) });
    expect(response.status).toBe(409);
    expect(recorder.enabled).toBe(true);
  });
});
