import type { Artifact } from "@/types/artifacts";

export type CanonicalTranscriptProjectionType = "renderable" | "model" | "audit";

export type CanonicalTranscriptEventKind =
  | "user_message"
  | "assistant_message"
  | "system_message"
  | "planner_message"
  | "tool_call"
  | "tool_result"
  | "connector_call"
  | "connector_result"
  | "web_search_result"
  | "image_generation_result"
  | "artifact_reference"
  | "artifact_created"
  | "artifact_updated"
  | "artifact_completed"
  | "artifact_failed"
  | "artifact_permission_requested"
  | "attachment_reference"
  | "memory_reference"
  | "context_reference"
  | "context_summary"
  | "runtime_event"
  | "status"
  | "interruption"
  | "retry"
  | "edit"
  | "branch_created";

export type CanonicalTranscriptEventRole = "system" | "user" | "assistant" | "tool";

export type CanonicalTranscriptEventStatus =
  | "active"
  | "superseded"
  | "interrupted"
  | "failed"
  | "cancelled";

export type CanonicalTranscriptEventVisibility =
  | "renderable"
  | "model"
  | "internal"
  | "audit"
  | "hidden";

export interface CanonicalTranscriptEvent {
  id: string;
  conversationId: string;
  turnId: string | null;
  branchId: string;
  logicalId: string | null;
  revisionId: string | null;
  revisionNumber: number;
  previousRevisionId: string | null;
  replacesEventId: string | null;
  status: CanonicalTranscriptEventStatus;
  storageVersion: number;
  projectionVersion: number;
  runId: string | null;
  sequence: number;
  source: string;
  kind: CanonicalTranscriptEventKind;
  visibility: CanonicalTranscriptEventVisibility;
  role: CanonicalTranscriptEventRole | null;
  content: string | null;
  summary: string | null;
  toolCallId: string | null;
  toolName: string | null;
  artifactId: string | null;
  attachmentId: string | null;
  sidePayloadId: string | null;
  segmentId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface CanonicalTranscriptProjection {
  id?: string;
  format?: string;
  conversationId: string;
  branchId: string;
  projectionType: CanonicalTranscriptProjectionType;
  lastSequence?: number;
  eventCount?: number;
  events: CanonicalTranscriptEvent[];
  updatedAt: string;
}

export interface CanonicalTranscriptFetchOptions {
  conversationId: string;
  branchId?: string;
  limit?: number;
  signal?: AbortSignal;
}

export interface CanonicalArtifactReference {
  artifactId: string;
  eventId: string;
  kind: CanonicalTranscriptEventKind;
  title?: string;
  summary?: string;
  status?: string;
  artifact?: Artifact;
}

export interface CanonicalTranscriptLoadResult {
  projection: CanonicalTranscriptProjection;
  artifacts: CanonicalArtifactReference[];
}
