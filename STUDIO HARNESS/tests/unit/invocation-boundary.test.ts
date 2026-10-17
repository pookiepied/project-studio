import { afterEach, describe, expect, it, vi } from "vitest";
import type { FlueExecutionInterceptor, FlueInstrumentation } from "@flue/runtime";
import { registerFlueTurnBoundary, unregisterFlueInstrumentation } from "../../src/observability/flue.js";
import { rememberInvocation } from "../../src/observability/invocations.js";
import { bindObservationContext, diagnosticRecorder, recordObservation } from "../../src/observability/recorder.js";
import { createRootExecutionContext, currentExecutionContext, runWithExecutionContext } from "../../src/execution/context.js";
import { recordFlueObservation } from "../../src/observability/runtime-observations.js";

const fixture = vi.hoisted(() => ({ interceptor: undefined as FlueExecutionInterceptor | undefined }));
vi.mock("@flue/runtime", async (original) => ({
  ...await original<typeof import("@flue/runtime")>(),
  instrument: (instrumentation: FlueInstrumentation) => {
    fixture.interceptor = instrumentation.interceptor;
    return async () => undefined;
  },
}));

afterEach(async () => {
  await unregisterFlueInstrumentation();
  diagnosticRecorder.configure({ enabled: false, captureContent: false, conversations: [] });
  diagnosticRecorder.clear();
});

describe("detached invocation boundary", () => {
  it("marks an unindexed durable entry and its children unavailable instead of guessing fresh consent", async () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["missing-parent"] });
    registerFlueTurnBoundary(async () => undefined);
    const interceptor = fixture.interceptor;
    if (interceptor === undefined) throw new Error("No registered interceptor");
    const context = { agentName: "studio", instanceId: "missing-parent", submissionId: "unindexed-submission" };
    await interceptor({ type: "agent", operationKind: "prompt", operationId: "unindexed-runtime" }, context, async () => {
      expect(currentExecutionContext()?.observationStartUnobserved).toBe(true);
      await interceptor({ type: "model", turnId: "unindexed-turn" }, context, async () => {
        recordObservation({ name: "test.unindexed", phase: "progress", content: "unproven old content" });
      });
    });
    const event = diagnosticRecorder.read().events.find((item) => item.name === "test.unindexed");
    expect(event).toMatchObject({ contentState: "unavailable", contentOmission: "start_unobserved" });
    expect(event?.content).toBeUndefined();
    // Seeing a running/settled envelope does not recreate an evicted admission.
    recordFlueObservation({ type: "submission_running", ...context, v: 3, eventIndex: 1,
      timestamp: "2026-10-16T00:00:00.000Z", kind: "direct", attemptCount: 1, maxAttempts: 1 });
    recordFlueObservation({ type: "submission_settled", ...context, v: 3, eventIndex: 2,
      timestamp: "2026-10-16T00:00:00.000Z", outcome: "failed", error: { message: "unproven old content" } });
    expect(diagnosticRecorder.read().events.at(-1)?.contentOmission).toBe("start_unobserved");
    expect(diagnosticRecorder.read().events.at(-1)?.content).toBeUndefined();
  });
  it("restores the dispatched parent and its old consent over a worker's unrelated context", async () => {
    diagnosticRecorder.configure({ enabled: true, captureContent: true, conversations: ["selected"] });
    const invocation = bindObservationContext(createRootExecutionContext());
    rememberInvocation("title", "selected-t1", invocation, "selected")("detached-submission");
    diagnosticRecorder.clear();
    const worker = bindObservationContext(createRootExecutionContext());
    registerFlueTurnBoundary(async () => undefined);
    const interceptor = fixture.interceptor;
    if (interceptor === undefined) throw new Error("No registered interceptor");
    const context = { agentName: "title", instanceId: "selected-t1", submissionId: "detached-submission" };
    const value = {};
    const result = await runWithExecutionContext(worker, () => interceptor(
      { type: "agent", operationKind: "prompt", operationId: "runtime-operation" }, context, async () => {
        const active = currentExecutionContext();
        expect(active?.requestId).toBe(invocation.requestId);
        expect(active?.parentOperationId).toBe(invocation.operationId);
        expect(active?.observationCaptureId).toBe(invocation.observationCaptureId);
        // Installed Flue wraps the session prompt again without submissionId.
        await interceptor({ type: "agent", operationKind: "prompt", operationId: "session-operation" },
          { agentName: context.agentName, instanceId: context.instanceId }, async () => {
            expect(currentExecutionContext()?.parentOperationId).toBe(active?.operationId);
            expect(currentExecutionContext()?.flueSubmissionId).toBe(context.submissionId);
            expect(currentExecutionContext()?.observationCaptureId).toBe(invocation.observationCaptureId);
          });
        await interceptor({ type: "model", turnId: "turn" }, context, async () => {
          expect(currentExecutionContext()?.parentOperationId).toBe(active?.operationId);
          expect(currentExecutionContext()?.observationCaptureId).toBe(invocation.observationCaptureId);
        });
        return value;
      }));
    expect(result).toBe(value);
    expect(diagnosticRecorder.read().events.every((event) => event.identity.requestId === invocation.requestId &&
      event.contentOmission === "capture_epoch_changed")).toBe(true);
  });
});
