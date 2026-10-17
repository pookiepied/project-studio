/** Versioned, exporter-neutral observations. IDs correlate; they never authorize. */
import type { ObservationSource } from "./source-observations.js";
export const DIAGNOSTIC_FORMAT_VERSION = 1 as const;

export type ObservationPhase = "start" | "progress" | "end";
export type ObservationOutcome = "completed" | "failed" | "cancelled" | "unknown";
export type DiagnosticValue = null | boolean | number | string | readonly DiagnosticValue[] |
  { readonly [key: string]: DiagnosticValue };

declare const diagnosticCaptureHandle: unique symbol;
/** Only the source-frame/projection factories create this opaque capture input. */
export interface DiagnosticCaptureHandle { readonly [diagnosticCaptureHandle]: true }
export type DiagnosticContent = null | boolean | number | bigint | string | DiagnosticCaptureHandle;

export interface ObservationIdentity {
  readonly requestId?: string;
  readonly operationId?: string;
  readonly parentOperationId?: string;
  readonly attemptId?: string;
  readonly conversationId?: string;
  readonly submissionId?: string;
  readonly runtimeConversationId?: string;
  readonly runtimeOperationId?: string;
  readonly turnId?: string;
  readonly toolCallId?: string;
  readonly taskId?: string;
  readonly jobId?: string;
  /** Opaque provider-owned generation identity; never a Studio job or retry key. */
  readonly externalJobId?: string;
  readonly agentName?: string;
  readonly agentInstanceId?: string;
  readonly invocationId?: string;
  readonly traceId?: string;
  readonly spanId?: string;
  readonly streamId?: string;
  readonly messageId?: string;
  readonly blockId?: string;
}

export interface StudioObservation {
  readonly v: typeof DIAGNOSTIC_FORMAT_VERSION;
  readonly eventId: string;
  readonly bootId: string;
  /** Process-local sequence, independent of Flue's per-context eventIndex. */
  readonly sequence: number;
  readonly timestamp: string;
  readonly monotonicMs: number;
  readonly name: string;
  readonly phase: ObservationPhase;
  readonly outcome?: ObservationOutcome;
  readonly identity: ObservationIdentity;
  readonly attributes: Readonly<Record<string, DiagnosticValue>>;
  readonly content?: DiagnosticValue;
  readonly contentState: "disabled" | "out_of_scope" | "absent" | "unavailable" | "captured" | "projected" | "truncated";
  readonly contentOmission?: "capture_epoch_changed" | "start_unobserved";
  /** Present for a separately observed process. Its clock is not the receipt clock. */
  readonly source?: ObservationSource;
}

export interface DiagnosticPolicy {
  readonly enabled: boolean;
  readonly captureContent: boolean;
  /** Content capture is limited to these product conversation IDs. Empty = none. */
  readonly conversations: readonly string[];
  readonly maxEvents: number;
  readonly maxBytes: number;
  readonly maxEventBytes: number;
}

export interface DiagnosticHealth {
  readonly bootId: string;
  /** Changes when capture consent changes or retained evidence is cleared. */
  readonly captureId: string;
  readonly policy: DiagnosticPolicy;
  readonly latestSequence: number;
  readonly retainedEvents: number;
  readonly retainedBytes: number;
  readonly evictedEvents: number;
  readonly droppedEvents: number;
}

export interface DiagnosticPage {
  readonly events: readonly StudioObservation[];
  readonly nextSequence: number;
  /** A different boot or evicted/deleted history requires a fresh read. */
  readonly gap: boolean;
  readonly health: DiagnosticHealth;
}
