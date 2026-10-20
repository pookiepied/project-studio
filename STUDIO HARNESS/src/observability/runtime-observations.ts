import type { FlueObservation } from "@flue/runtime";
import { diagnosticRecorder, recordObservation } from "./recorder.js";
import { diagnosticProjectedContent, diagnosticValue } from "./diagnostic-value.js";
import { flueObservationContent } from "./observation-source.js";
import { currentExecutionContext, runWithExecutionContext } from "../execution/context.js";
import { invocationFor } from "./invocations.js";

const submissionCaptures = new Map<string, string>();

/** Capture live-only evidence as well as lifecycle, without treating replay as execution. */
export function recordFlueObservation(event: FlueObservation): void {
  if (!diagnosticRecorder.enabled) return;
  try {
    const raw = event as unknown as Record<string, unknown>;
    const identity: Record<string, string> = {};
    const fields = {
      instanceId: "conversationId", submissionId: "submissionId", conversationId: "runtimeConversationId",
      operationId: "runtimeOperationId", turnId: "turnId", toolCallId: "toolCallId",
      taskId: "taskId", agentName: "agentName",
    };
    for (const [key, mapped] of Object.entries(fields)) {
      if (typeof raw[key] === "string") identity[mapped] = raw[key];
    }
    const invocation = invocationFor(identity.agentName, identity.conversationId, identity.submissionId);
    if (invocation !== undefined) {
      identity.agentInstanceId = invocation.instanceId;
      identity.invocationId = invocation.execution.operationId;
      identity.requestId = invocation.execution.requestId;
      delete identity.conversationId;
      if (invocation.conversationId !== undefined) identity.conversationId = invocation.conversationId;
    }
    const submissionId = identity.submissionId;
    if (submissionId !== undefined && submissionId.length <= 256 && event.type === "submission_running") {
      submissionCaptures.set(submissionId, diagnosticRecorder.captureId);
      if (submissionCaptures.size > 10_000) {
        const oldest = submissionCaptures.keys().next().value;
        if (oldest !== undefined) submissionCaptures.delete(oldest);
      }
    }
    const current = currentExecutionContext();
    const unrelatedWorker = invocation !== undefined && current?.requestId !== invocation.execution.requestId;
    const currentCapture = unrelatedWorker ? undefined : current?.observationCaptureId;
    const contextualCapture = currentCapture === undefined ? invocation?.execution.observationCaptureId : currentCapture;
    const submissionCapture = submissionId === undefined ? undefined : submissionCaptures.get(submissionId);
    const invocationCapture = invocation?.execution.observationCaptureId;
    const provenStart = invocationCapture !== undefined && !invocation?.execution.observationStartUnobserved ||
      current?.flueSubmissionId === submissionId && currentCapture !== undefined && !current?.observationStartUnobserved;
    const changed = (contextualCapture !== undefined && contextualCapture !== diagnosticRecorder.captureId) ||
      (invocationCapture !== undefined && invocationCapture !== diagnosticRecorder.captureId) ||
      (submissionCapture !== undefined && submissionCapture !== diagnosticRecorder.captureId);
    const contentOmission = changed ? "capture_epoch_changed" as const
      : submissionId !== undefined && !provenStart ? "start_unobserved" as const : undefined;
    const attributes: Record<string, unknown> = {};
    for (const key of ["v", "eventIndex", "timestamp", "durationMs", "purpose", "operationKind", "toolName", "origin", "isError", "outcome", "agent"]) {
      const value = raw[key];
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") attributes[key] = value;
    }
    if (event.type === "log" && typeof raw.attributes === "object" && raw.attributes !== null && "stage" in raw.attributes) {
      const stage = raw.attributes.stage;
      if (stage === "steering_requested" || stage === "steering_context_ready") attributes.stage = stage;
    }
    // Only allowlisted summaries enter operational capture. Requests/results stay gated.
    const response = raw.response as Record<string, unknown> | undefined;
    if (response && typeof response === "object") {
      attributes.usage = diagnosticValue(diagnosticProjectedContent(response.usage,
        ["input", "output", "cacheRead", "cacheWrite", "totalTokens", "cost", "total"]), 1000);
      if (typeof response.finishReason === "string") attributes.finishReason = response.finishReason;
      if (typeof response.responseModel === "string") attributes.responseModel = response.responseModel;
    }
    const request = raw.request as Record<string, unknown> | undefined;
    if (request && typeof request === "object") {
      for (const key of ["providerId", "providerName", "requestedModel", "api", "reasoningLevel", "maxTokens", "temperature"]) {
        const value = request[key];
        if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") attributes[key] = value;
      }
    }
    const failed = raw.isError === true || raw.outcome === "failed";
    const aborted = raw.outcome === "aborted" || (event.type === "turn" && response?.finishReason === "aborted");
    const terminal = event.type === "submission_settled" || ["operation", "turn", "tool", "task", "compaction", "agent_end"].includes(event.type);
    const record = () => recordObservation({
      name: `runtime.${event.type}`, identity,
      phase: terminal ? "end" : event.type.endsWith("_start") || event.type === "turn_request" ? "start" : "progress",
      ...(terminal ? { outcome: aborted ? "cancelled" as const : failed ? "failed" as const : event.type === "agent_end" ? "unknown" as const : "completed" as const } : {}),
      attributes,
      ...(contentOmission === undefined ? { content: flueObservationContent(event) } : { contentOmission }),
    });
    if (unrelatedWorker) runWithExecutionContext(invocation.execution, record);
    else record();
  } catch { /* Runtime observation subscribers must stay passive. */ }
}
