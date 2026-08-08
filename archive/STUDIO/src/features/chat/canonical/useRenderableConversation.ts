import { useEffect, useState } from "react";
import { logger } from "@/core/logging/logger";
import {
  loadRenderableConversation,
  type RenderableConversationState,
} from "./loadRenderableConversation";

export type RenderableConversationLoadStatus =
  | "idle"
  | "loading"
  | "ready"
  | "empty"
  | "error";

export interface UseRenderableConversationOptions {
  conversationId?: string | null;
  branchId?: string;
  limit?: number;
  enabled?: boolean;
}

export interface UseRenderableConversationResult {
  status: RenderableConversationLoadStatus;
  state: RenderableConversationState | null;
  error: string | null;
  reload: () => void;
}

export function useRenderableConversation({
  conversationId,
  branchId = "main",
  limit,
  enabled = true,
}: UseRenderableConversationOptions): UseRenderableConversationResult {
  const [version, setVersion] = useState(0);
  const [status, setStatus] = useState<RenderableConversationLoadStatus>("idle");
  const [state, setState] = useState<RenderableConversationState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !conversationId) {
      setStatus("idle");
      setState(null);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setStatus("loading");
    setError(null);

    loadRenderableConversation({
      conversationId,
      branchId,
      limit,
      signal: controller.signal,
    })
      .then((nextState) => {
        if (controller.signal.aborted) return;
        setState(nextState);
        setStatus(nextState.messages.length ? "ready" : "empty");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        const message = err instanceof Error ? err.message : "Failed to load conversation.";
        logger.warn("CanonicalTranscript", message, { conversationId, branchId });
        setState(null);
        setError(message);
        setStatus("error");
      });

    return () => controller.abort();
  }, [branchId, conversationId, enabled, limit, version]);

  return {
    status,
    state,
    error,
    reload: () => setVersion((current) => current + 1),
  };
}
