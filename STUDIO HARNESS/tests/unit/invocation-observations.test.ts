import { afterEach, describe, expect, it } from "vitest";
import { createChildExecutionContext, createRootExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";
import { rememberInvocation, invocationFor, observeInvocationAdmission, forgetProvisionalInvocation } from "../../src/observability/invocations.js";
import { bindObservationContext, diagnosticRecorder, executionIdentity } from "../../src/observability/recorder.js";
import { recordFlueObservation } from "../../src/observability/runtime-observations.js";
import type { FlueObservation } from "@flue/runtime";

afterEach(() => {
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
});

describe("background invocation correlation", () => {
  it("binds concurrent admissions at their producer instead of choosing the latest instance entry", () => {
    const first = createRootExecutionContext();
    const second = createRootExecutionContext();
    rememberInvocation("studio", "parallel", first, "parallel");
    rememberInvocation("studio", "parallel", second, "parallel");
    expect(invocationFor("studio", "parallel", "parallel-first")).toBeUndefined();
    observeInvocationAdmission("studio", "parallel", "parallel-first", false, first);
    observeInvocationAdmission("studio", "parallel", "parallel-second", false, second);
    expect(invocationFor("studio", "parallel", "parallel-first")?.execution).toBe(first);
    expect(invocationFor("studio", "parallel", "parallel-second")?.execution).toBe(second);
    forgetProvisionalInvocation(first.operationId);
    expect(invocationFor("studio", "parallel", "parallel-first")?.execution).toBe(first);
  });

  it("removes refused candidates and declines ambiguous producer families", () => {
    const refused = createRootExecutionContext();
    rememberInvocation("studio", "refused", refused, "refused");
    forgetProvisionalInvocation(refused.operationId);
    observeInvocationAdmission("studio", "refused", "never-admitted", false, refused);
    expect(invocationFor("studio", "refused")).toBeUndefined();
    expect(invocationFor("studio", "refused", "never-admitted")).toBeUndefined();
    const root = createRootExecutionContext();
    const first = createChildExecutionContext(root, { kind: "request" });
    const second = createChildExecutionContext(root, { kind: "request" });
    rememberInvocation("studio", "ambiguous", first);
    rememberInvocation("studio", "ambiguous", second);
    observeInvocationAdmission("studio", "ambiguous", "unproven-submission", false, createChildExecutionContext(root, { kind: "unknown" }));
    expect(invocationFor("studio", "ambiguous", "unproven-submission")).toBeUndefined();
    forgetProvisionalInvocation(first.operationId);
    forgetProvisionalInvocation(second.operationId);
  });
  it("joins detached title retries to their request and product scope without changing permission scope", () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const parent = bindObservationContext(createRootExecutionContext());
    rememberInvocation("title", "selected-t1", parent, "selected")("title-submission");
    const execution = createChildExecutionContext(parent, { kind: "model", flue: {
      agentName: "title", instanceId: "selected-t1", submissionId: "title-submission",
    } });
    const identity = runWithExecutionContext(execution, executionIdentity);
    expect(execution.flueInstanceId).toBe("selected-t1");
    expect(identity).toMatchObject({ conversationId: "selected", agentInstanceId: "selected-t1",
      requestId: parent.requestId, invocationId: parent.operationId });
    const observation = { type: "submission_running", agentName: "title", instanceId: "selected-t1",
      submissionId: "title-submission" } as FlueObservation;
    recordFlueObservation(observation);
    expect(diagnosticRecorder.read().events[0]?.identity).toMatchObject({ conversationId: "selected",
      invocationId: parent.operationId, requestId: parent.requestId, agentInstanceId: "selected-t1" });
    expect(diagnosticRecorder.read().events[0]?.identity.parentOperationId).toBe(parent.parentOperationId);
    runWithExecutionContext(execution, () => recordFlueObservation(observation));
    expect(diagnosticRecorder.read().events.at(-1)?.identity).toMatchObject({ operationId: execution.operationId,
      parentOperationId: parent.operationId, invocationId: parent.operationId });
    expect(diagnosticRecorder.read().events.every((event) => event.identity.operationId !== event.identity.parentOperationId)).toBe(true);
    diagnosticRecorder.clear();
    const newerWorker = bindObservationContext(createRootExecutionContext());
    runWithExecutionContext(newerWorker, () => recordFlueObservation(observation));
    expect(diagnosticRecorder.read().events[0]?.contentOmission).toBe("capture_epoch_changed");
    expect(diagnosticRecorder.read().events[0]?.content).toBeUndefined();
  });

  it("does not let a stale worker's consent suppress a newly admitted invocation", () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["new-selected"] });
    const worker = bindObservationContext(createRootExecutionContext());
    diagnosticRecorder.clear();
    const admitted = bindObservationContext(createRootExecutionContext());
    rememberInvocation("studio", "new-selected", admitted, "new-selected")("new-direct-submission");
    runWithExecutionContext(worker, () => recordFlueObservation({ type: "submission_running", v: 3, eventIndex: 1,
      timestamp: "2026-10-16T00:00:00.000Z", instanceId: "new-selected", agentName: "studio",
      submissionId: "new-direct-submission", kind: "direct", attemptCount: 1, maxAttempts: 2 }));
    const event = diagnosticRecorder.read().events[0];
    expect(event?.identity.requestId).toBe(admitted.requestId);
    expect(event?.contentOmission).toBeUndefined();
    expect(event?.content).toBeDefined();
  });

  it("keeps ephemeral invocations outside product content scope and distinguishes reused instances", () => {
    const first = createRootExecutionContext();
    rememberInvocation("improve", "reused", first)("first-submission");
    const second = createRootExecutionContext();
    const link = rememberInvocation("improve", "reused", second);
    expect(invocationFor("improve", "reused", "first-submission")?.execution).toBe(first);
    link("second-submission");
    expect(invocationFor("improve", "reused", "second-submission")?.execution).toBe(second);
    rememberInvocation("improve", "reused", createRootExecutionContext())("second-submission");
    expect(invocationFor("improve", "reused", "second-submission")?.execution).toBe(second);
    expect(invocationFor("other", "reused", "first-submission")).toBeUndefined();
    expect(invocationFor("improve", "reused", "unobserved")).toBeUndefined();
    const execution = createChildExecutionContext(second, { kind: "model", flue: {
      agentName: "improve", instanceId: "reused", submissionId: "second-submission",
    } });
    expect(runWithExecutionContext(execution, executionIdentity).conversationId).toBeUndefined();
  });

  it("evicts all indexes together when the process window fills", () => {
    rememberInvocation("test", "old", createRootExecutionContext())("old-submission");
    for (let index = 0; index < 10_000; index++) rememberInvocation("test", String(index), createRootExecutionContext())(`submission-${index}`);
    expect(invocationFor("test", "old", "old-submission")).toBeUndefined();
    expect(invocationFor("test", "old")).toBeUndefined();
    expect(invocationFor("test", "9999", "submission-9999")).toBeDefined();
    rememberInvocation("test", "old", createRootExecutionContext())("old-submission", true);
    expect(invocationFor("test", "old", "old-submission")).toBeUndefined();
    expect(invocationFor("test", "old")).toBeUndefined();
  });
});
