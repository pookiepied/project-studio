import type { ChatMessage, MessageSegment } from "@/features/chat/types";
import type {
  CanonicalArtifactReference,
  CanonicalTranscriptEvent,
  CanonicalTranscriptProjection,
} from "./types";

function timestamp(event: CanonicalTranscriptEvent): number {
  const parsed = Date.parse(event.createdAt);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function eventText(event: CanonicalTranscriptEvent): string {
  return event.content ?? event.summary ?? "";
}

function artifactTitle(event: CanonicalTranscriptEvent): string {
  const title = event.metadata?.title;
  if (typeof title === "string" && title.trim()) return title.trim();
  if (event.summary) return event.summary;
  return event.artifactId ? `Artifact ${event.artifactId}` : "Artifact";
}

function artifactSummary(event: CanonicalTranscriptEvent): string {
  if (event.summary) return event.summary;
  const status = event.metadata?.status;
  return typeof status === "string" ? status : event.kind.split("_").join(" ");
}

function eventArtifact(event: CanonicalTranscriptEvent): CanonicalArtifactReference["artifact"] {
  return typeof event.metadata?.artifact === "object" && event.metadata.artifact !== null
    ? event.metadata.artifact as CanonicalArtifactReference["artifact"]
    : undefined;
}

function makeToolSegment(event: CanonicalTranscriptEvent): MessageSegment | null {
  if (!event.toolName) return null;
  if (event.kind !== "tool_call" && event.kind !== "tool_result" && event.kind !== "connector_result") return null;

  const complete = event.kind !== "tool_call";
  return {
    type: "harness_event",
    event: {
      callId: event.toolCallId ?? event.id,
      tool: event.toolName,
      args: {},
      status: complete ? "complete" : "running",
      label: complete ? "Used" : "Using",
      target: event.summary ?? event.toolName,
      preview: event.content ?? undefined,
    },
  };
}

function isArtifactEvent(event: CanonicalTranscriptEvent): boolean {
  return Boolean(event.artifactId) || event.kind.startsWith("artifact_");
}

function isRenderableMessage(event: CanonicalTranscriptEvent): boolean {
  return event.kind === "user_message" || event.kind === "assistant_message" || event.kind === "planner_message";
}

export function collectArtifactReferences(
  projection: CanonicalTranscriptProjection,
): CanonicalArtifactReference[] {
  return projection.events.filter(isArtifactEvent).map((event) => ({
    artifactId: event.artifactId ?? event.id,
    eventId: event.id,
    kind: event.kind,
    title: typeof event.metadata?.title === "string" ? event.metadata.title : artifactTitle(event),
    summary: artifactSummary(event),
    status: typeof event.metadata?.status === "string" ? event.metadata.status : event.status,
    artifact: eventArtifact(event),
  }));
}

export function renderableProjectionToChatMessages(
  projection: CanonicalTranscriptProjection,
): ChatMessage[] {
  const messages: ChatMessage[] = [];

  for (const event of projection.events) {
    const text = eventText(event);

    if (isRenderableMessage(event)) {
      const role = event.role === "user" ? "user" : "assistant";
      messages.push({
        id: event.id,
        role,
        content: text,
        timestamp: timestamp(event),
        metadata: {
          type: "normal",
          canonical: {
            conversationId: event.conversationId,
            turnId: event.turnId,
            branchId: event.branchId,
            eventIds: [event.id],
            sequenceRange: [event.sequence, event.sequence],
            revisionId: event.revisionId,
            revisionNumber: event.revisionNumber,
            status: event.status,
            sourceKinds: [event.kind],
          },
        },
      });
      continue;
    }

    const segment = makeToolSegment(event);
    if (segment) {
      messages.push({
        id: event.id,
        role: "assistant",
        content: text || event.summary || event.toolName || event.kind,
        timestamp: timestamp(event),
        segments: [segment],
        metadata: {
          type: "normal",
          canonical: {
            conversationId: event.conversationId,
            turnId: event.turnId,
            branchId: event.branchId,
            eventIds: [event.id],
            sequenceRange: [event.sequence, event.sequence],
            status: event.status,
            sourceKinds: [event.kind],
            toolCallIds: event.toolCallId ? [event.toolCallId] : undefined,
          },
        },
      });
      continue;
    }

    if (isArtifactEvent(event)) {
      messages.push({
        id: event.id,
        role: "assistant",
        content: `${artifactTitle(event)}\n\n${artifactSummary(event)}`.trim(),
        timestamp: timestamp(event),
        metadata: {
          type: "normal",
          canonical: {
            conversationId: event.conversationId,
            turnId: event.turnId,
            branchId: event.branchId,
            eventIds: [event.id],
            sequenceRange: [event.sequence, event.sequence],
            status: event.status,
            sourceKinds: [event.kind],
            artifactIds: event.artifactId ? [event.artifactId] : undefined,
            artifact: eventArtifact(event),
          },
        },
      });
    }
  }

  return messages;
}
