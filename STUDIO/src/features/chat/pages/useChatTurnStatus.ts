import { useMemo } from "react";
import type { ChatEngine } from "@/cliBridges/types";
import type { ActiveToolCall } from "@/features/chat/context/types";
import type { MessageSegment } from "@/types";

interface ChatTurnStatusOptions {
  activeToolCalls: ActiveToolCall[];
  streamingContent: string;
  thinkingContent: string;
  harnessSegments: MessageSegment[];
  isLoading: boolean;
  isStreaming: boolean;
  streamingMessageId: string | null;
  hasMessages: boolean;
  pendingPermission: string | null;
  chatEngine: ChatEngine;
  conversationId?: string;
  usageContextTokens?: number | null;
  contextLimit?: number;
}

export function useChatTurnStatus({
  activeToolCalls,
  streamingContent,
  thinkingContent,
  harnessSegments,
  isLoading,
  isStreaming,
  streamingMessageId,
  hasMessages,
  pendingPermission,
  chatEngine,
  conversationId,
  usageContextTokens,
  contextLimit,
}: ChatTurnStatusOptions) {
  return useMemo(() => {
    const runningTurnTool = activeToolCalls.find(
      (toolCall) => toolCall.status === "running" && !toolCall.parentCallId,
    );
    const hasVisibleTurnActivity =
      streamingContent.trim().length > 0 ||
      thinkingContent.trim().length > 0 ||
      harnessSegments.length > 0 ||
      !!runningTurnTool;
    const hasActiveTurn = isLoading || isStreaming || !!streamingMessageId;
    const isPreparingTurn = hasActiveTurn && !hasVisibleTurnActivity;

    if (!hasMessages || pendingPermission) return null;

    return {
      engine: chatEngine,
      convId: conversationId,
      generating: isPreparingTurn || hasVisibleTurnActivity,
      label: (() => {
        if (isPreparingTurn) return "Preparing";
        if (runningTurnTool) return "Working";
        if (streamingContent.length > 0) return "Responding";
        return "Thinking";
      })(),
      thinking: thinkingContent,
      contextUsed: usageContextTokens && usageContextTokens > 0 ? usageContextTokens : undefined,
      contextLimit,
    };
  }, [
    activeToolCalls,
    chatEngine,
    contextLimit,
    conversationId,
    harnessSegments,
    hasMessages,
    isLoading,
    isStreaming,
    pendingPermission,
    streamingContent,
    streamingMessageId,
    thinkingContent,
    usageContextTokens,
  ]);
}
