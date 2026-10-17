import { context, trace } from "@opentelemetry/api";
import { performance } from "node:perf_hooks";
import { createStudioUuid } from "../contracts/uuid.js";
import {
  DIAGNOSTIC_FORMAT_VERSION,
  type DiagnosticHealth, type DiagnosticPage, type DiagnosticPolicy,
  type ObservationIdentity, type ObservationOutcome, type ObservationPhase,
  type StudioObservation, type DiagnosticValue, type DiagnosticContent,
} from "../contracts/diagnostics.js";
import { currentExecutionContext, type ExecutionContext } from "../execution/context.js";
import { diagnosticValue, serializeDiagnosticValue } from "./diagnostic-value.js";
import type { ObservationSource } from "../contracts/source-observations.js";
import { invocationFor } from "./invocations.js";

const DEFAULT_POLICY: DiagnosticPolicy = {
  enabled: false, captureContent: false, conversations: [],
  maxEvents: 2_000, maxBytes: 4 * 1024 * 1024, maxEventBytes: 32 * 1024,
};

export interface ObservationInput {
  /** Stable feature/stage name, never a prompt, URL, path or error message. */
  readonly name: string;
  readonly phase: ObservationPhase;
  readonly outcome?: ObservationOutcome;
  readonly identity?: ObservationIdentity;
  /** Only operational metadata. Bodies, args, results and stacks go in content. */
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly content?: DiagnosticContent | undefined;
  readonly contentOmission?: StudioObservation["contentOmission"];
  readonly source?: ObservationSource;
}

/** A bounded local flight recorder. No disk, network, timers or business ownership. */
export class DiagnosticRecorder {
  readonly bootId = createStudioUuid();
  #captureId = createStudioUuid();
  #policy: DiagnosticPolicy = { ...DEFAULT_POLICY };
  #events: { event: StudioObservation; bytes: number }[] = [];
  #bytes = 0;
  #sequence = 0;
  #evicted = 0;
  #dropped = 0;
  #deletedThrough = 0;

  get enabled(): boolean { return this.#policy.enabled; }
  get captureId(): string { return this.#captureId; }

  capturesContent(conversationId: string | undefined): boolean {
    return this.enabled && this.#policy.captureContent && conversationId !== undefined && this.#policy.conversations.includes(conversationId);
  }

  configure(input: Partial<DiagnosticPolicy>): DiagnosticHealth {
    const previous = this.#policy;
    const merged = { ...this.#policy, ...input };
    const bound = (value: number, min: number, max: number): number =>
      Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : min;
    this.#policy = {
      enabled: merged.enabled === true,
      captureContent: merged.captureContent === true,
      conversations: [...new Set(merged.conversations.filter((id) => typeof id === "string" && id.length <= 256))].slice(0, 100),
      maxEvents: bound(merged.maxEvents, 1, 10_000),
      maxBytes: bound(merged.maxBytes, 4096, 32 * 1024 * 1024),
      maxEventBytes: bound(merged.maxEventBytes, 2048, 128 * 1024),
    };
    // Stopping preserves evidence for export. Revoking content/scope removes it.
    if (previous.captureContent !== this.#policy.captureContent ||
        JSON.stringify(previous.conversations) !== JSON.stringify(this.#policy.conversations)) this.clear();
    else if (previous.enabled !== this.#policy.enabled) this.#captureId = createStudioUuid();
    this.#trim();
    return this.health();
  }

  clear(): void {
    this.#events = [];
    this.#bytes = 0;
    this.#deletedThrough = this.#sequence;
    this.#captureId = createStudioUuid();
  }

  health(): DiagnosticHealth {
    return {
      bootId: this.bootId, captureId: this.#captureId, policy: { ...this.#policy, conversations: [...this.#policy.conversations] },
      latestSequence: this.#sequence, retainedEvents: this.#events.length,
      retainedBytes: this.#bytes, evictedEvents: this.#evicted, droppedEvents: this.#dropped,
    };
  }

  record(input: ObservationInput): void {
    if (!this.enabled) return;
    const sequence = ++this.#sequence;
    try {
      if (!/^[a-z][a-zA-Z0-9_.-]{0,119}$/.test(input.name)) { this.#dropped++; return; }
      const identity = diagnosticValue(input.identity ?? {}) as ObservationIdentity;
      const inScope = identity.conversationId !== undefined && this.#policy.conversations.includes(identity.conversationId);
      const capture = this.#policy.captureContent && inScope;
      const captured = capture && input.contentOmission === undefined && input.content !== undefined ? serializeDiagnosticValue(input.content) : undefined;
      let event: StudioObservation = {
        v: DIAGNOSTIC_FORMAT_VERSION, eventId: createStudioUuid(), bootId: this.bootId,
        sequence, timestamp: new Date().toISOString(), monotonicMs: performance.now(),
        name: input.name.slice(0, 120), phase: input.phase,
        ...(input.outcome === undefined ? {} : { outcome: input.outcome }), identity,
        attributes: diagnosticValue(input.attributes ?? {}, 2000) as Record<string, DiagnosticValue>,
        ...(captured === undefined ? {} : { content: captured.value }),
        contentState: !this.#policy.captureContent ? "disabled" : !inScope ? "out_of_scope" : input.contentOmission !== undefined ? "unavailable" : captured === undefined ? "absent" : captured.truncated ? "truncated" : captured.projected ? "projected" : "captured",
        ...(input.contentOmission === undefined ? {} : { contentOmission: input.contentOmission }),
        ...(input.source === undefined ? {} : { source: input.source }),
      };
      let json = JSON.stringify(event);
      if (Buffer.byteLength(json) > this.#policy.maxEventBytes) {
        event = { ...event, content: "[truncated: event byte limit]", contentState: "truncated" };
        json = JSON.stringify(event);
      }
      const bytes = Buffer.byteLength(json);
      if (bytes > Math.min(this.#policy.maxBytes, this.#policy.maxEventBytes)) { this.#dropped++; return; }
      // Store an immutable serialized snapshot, detached from all caller objects.
      this.#events.push({ event: JSON.parse(json) as StudioObservation, bytes });
      this.#bytes += bytes;
      this.#trim();
    } catch { this.#dropped++; }
  }

  #trim(): void {
    while (this.#events.length > this.#policy.maxEvents || this.#bytes > this.#policy.maxBytes) {
      const old = this.#events.shift();
      if (old) { this.#bytes -= old.bytes; this.#evicted++; this.#deletedThrough = old.event.sequence; }
    }
  }

  read(after = 0, limit = 100, bootId: string = this.bootId): DiagnosticPage {
    const cursor = Number.isSafeInteger(after) && after >= 0 ? after : 0;
    const count = Number.isFinite(limit) ? Math.min(500, Math.max(1, Math.floor(limit))) : 100;
    const mismatch = bootId !== this.bootId || cursor > this.#sequence;
    const events = this.#events.filter(({ event }) => event.sequence > (mismatch ? 0 : cursor)).slice(0, count);
    return {
      events: events.map(({ event }) => JSON.parse(JSON.stringify(event)) as StudioObservation),
      nextSequence: events.at(-1)?.event.sequence ?? this.#sequence,
      gap: mismatch || cursor < this.#deletedThrough || (events[0]?.event.sequence ?? this.#sequence + 1) > cursor + 1 ||
        events.some(({ event }, at) => at > 0 && events[at - 1]?.event.sequence !== event.sequence - 1),
      health: this.health(),
    };
  }
}

/** Same process-resource ownership as the OTel providers; disabled until configured. */
export const diagnosticRecorder = new DiagnosticRecorder();

export function executionIdentity(): ObservationIdentity {
  const execution = currentExecutionContext();
  const invocation = invocationFor(execution?.flueAgentName, execution?.flueInstanceId, execution?.flueSubmissionId);
  const span = trace.getSpan(context.active())?.spanContext();
  return {
    ...(execution === undefined ? {} : {
      requestId: execution.requestId, operationId: execution.operationId,
      attemptId: execution.attemptId,
      ...(execution.parentOperationId === undefined ? {} : { parentOperationId: execution.parentOperationId }),
      ...(invocation === undefined
        ? execution.flueInstanceId === undefined ? {} : { conversationId: execution.flueInstanceId }
        : { agentInstanceId: invocation.instanceId, invocationId: invocation.execution.operationId,
          ...(invocation.conversationId === undefined ? {} : { conversationId: invocation.conversationId }) }),
      ...(execution.flueSubmissionId === undefined ? {} : { submissionId: execution.flueSubmissionId }),
      ...(execution.flueConversationId === undefined ? {} : { runtimeConversationId: execution.flueConversationId }),
      ...(execution.flueOperationId === undefined ? {} : { runtimeOperationId: execution.flueOperationId }),
      ...(execution.flueTurnId === undefined ? {} : { turnId: execution.flueTurnId }),
      ...(execution.flueToolCallId === undefined ? {} : { toolCallId: execution.flueToolCallId }),
      ...(execution.flueTaskId === undefined ? {} : { taskId: execution.flueTaskId }),
      ...(execution.flueAgentName === undefined ? {} : { agentName: execution.flueAgentName }),
    }),
    ...(span === undefined ? {} : { traceId: span.traceId, spanId: span.spanId }),
  };
}

/** The safe emission port for feature authors. Disabled recording avoids enrichment. */
export function recordObservation(input: ObservationInput): void {
  if (!diagnosticRecorder.enabled) return;
  try {
    const execution = currentExecutionContext();
    const contextualCapture = execution?.observationCaptureId;
    const contextOmission = execution?.observationStartUnobserved ? "start_unobserved" as const
      : contextualCapture !== undefined && contextualCapture !== diagnosticRecorder.captureId ? "capture_epoch_changed" as const : undefined;
    diagnosticRecorder.record({ ...input,
      ...(contextOmission === undefined || input.contentOmission !== undefined ? {} : { contentOmission: contextOmission }),
      identity: { ...executionIdentity(), ...input.identity } });
  } catch { /* Diagnostics never become a product failure. */ }
}

/** Keep an asynchronous observer inside the consent epoch in which it started. */
export function createObservationWriter(): (input: ObservationInput) => void {
  const captureId = diagnosticRecorder.enabled ? diagnosticRecorder.captureId : undefined;
  return (input) => {
    if (captureId !== undefined && captureId === diagnosticRecorder.captureId) recordObservation(input);
  };
}

export function bindObservationContext(execution: ExecutionContext, newInvocation = false): ExecutionContext {
  if (!newInvocation && execution.observationCaptureId !== undefined) return execution;
  return { ...execution, observationCaptureId: diagnosticRecorder.enabled ? diagnosticRecorder.captureId : null };
}
