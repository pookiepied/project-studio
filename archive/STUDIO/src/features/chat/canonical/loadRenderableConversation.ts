import { fetchRenderableTranscriptProjection } from "./api";
import {
  collectArtifactReferences,
  renderableProjectionToChatMessages,
} from "./mapRenderableProjection";
import type { ChatMessage } from "@/features/chat/types";
import type {
  CanonicalArtifactReference,
  CanonicalTranscriptFetchOptions,
  CanonicalTranscriptProjection,
} from "./types";

export interface RenderableConversationState {
  projection: CanonicalTranscriptProjection;
  messages: ChatMessage[];
  artifacts: CanonicalArtifactReference[];
}

export async function loadRenderableConversation(
  options: CanonicalTranscriptFetchOptions,
): Promise<RenderableConversationState> {
  const projection = await fetchRenderableTranscriptProjection(options);
  return {
    projection,
    messages: renderableProjectionToChatMessages(projection),
    artifacts: collectArtifactReferences(projection),
  };
}
