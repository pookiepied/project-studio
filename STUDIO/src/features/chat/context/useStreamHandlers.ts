/**
 * Streaming turn handlers for the Studio engine (Local Runtime / WebSocket path).
 *
 * Owns everything that reacts to the agent's stream: the `useAgentChat` handler
 * bundle, the interactive-question segment, the harness-segment bridge for
 * locally-executed tools, and `handleStreamDone` (including the DSML tool-call
 * interception and the final persistence of the assistant message).
 *
 * Extracted verbatim from ChatProvider. State and refs still live in the
 * provider and arrive here as an explicit deps bundle, so the closure/staleness
 * profile of every callback is byte-for-byte what it was inline — the
 * `useCallback` dependency arrays below are unchanged from the original.
 *
 * The Claude engine's equivalent lives in `./runClaudeTurn.ts`. Both funnel
 * into `handleStreamDone`.
 */

import { useCallback, useEffect, useRef } from "react";
import {
  buildChatBody,
  getMcpServers,
  executeLocalTools,
  classifyToolDisplay,
  useAgentChat,
} from "@/runtime";
import { logger } from "@/core/logging/logger";
import { memorySystem } from "@/core/storage/memorySystem";
import { recordAgentToolResult } from "@/core/notifications";
import { parseChatResponse } from "@/lib/chatParser";
import { buildHarnessEvent } from "@/lib/harnessEventUtils";
import { hasDSML, parseDSML, stripDSMLForStreaming } from "@/lib/dsmlParser";
import {
  loadConversation,
  addMessage,
  getContextMessages,
} from "@/features/chat/conversations/chatHistoryService";
import type { ConversationStorageScope } from "@/core/conversations";
import { isClaudeOwnedConversation } from "@/features/chat/conversations/ownership/conversationOwnership";
import { pruneContextByTokens, applyAllSystemMessages } from "./messageBuilder";
import { buildToolExecutionCallbacks } from "./toolExecutionCallbacks";
import { MESSAGES_PER_PAGE, MAX_CONTEXT_MESSAGES } from "./constants";
import type { ActiveToolCall, TaskItem, ToolApprovalDecision } from "./types";
import type { ProjectCtx } from "./projectContextStorage";
import type { PermissionDecision } from "@/core/permissions";
import type {
  ChatConversation,
  ChatMessage,
  MessageSegment,
} from "@/types";
import type {
  APIChatMessage,
  AutoRoutedInfo,
  ToolResultItem,
} from "@/types/chat";

export interface StreamHandlerDeps {
  // ── Values ──────────────────────────────────────────────────────────────
  conversation: ChatConversation | null;
  conversationStorageScope: ConversationStorageScope;
  projectContext: ProjectCtx | null;
  currentModel: string;
  reasoningBudget: number | undefined;
  isMemoryEnabled: boolean;
  activeToolCalls: ActiveToolCall[];
  settings: { imageModel?: string; videoModel?: string };

  // ── Turn-scoped accumulators ────────────────────────────────────────────
  fullContentRef: React.MutableRefObject<string>;
  screenshotUrlsRef: React.MutableRefObject<string[]>;
  optimisticAssistantIdRef: React.MutableRefObject<string>;
  activeConversationIdRef: React.MutableRefObject<string>;
  latestStreamingContentRef: React.MutableRefObject<string>;
  thinkingContentRef: React.MutableRefObject<string>;
  harnessSegmentsRef: React.MutableRefObject<MessageSegment[]>;
  pendingSegmentTextRef: React.MutableRefObject<string>;
  pendingQuestionResolveRef: React.MutableRefObject<((a: string) => void) | null>;
  pendingQuestionSegmentIdRef: React.MutableRefObject<string | null>;
  pendingApprovalResolveRef: React.MutableRefObject<((d: ToolApprovalDecision) => void) | null>;
  handleStreamDoneRef: React.MutableRefObject<(() => Promise<void>) | null>;

  // ── State writers ───────────────────────────────────────────────────────
  setConversation: React.Dispatch<React.SetStateAction<ChatConversation | null>>;
  setDisplayedMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setHasMoreMessages: React.Dispatch<React.SetStateAction<boolean>>;
  setMessageOffset: React.Dispatch<React.SetStateAction<number>>;
  setActiveToolCalls: React.Dispatch<React.SetStateAction<ActiveToolCall[]>>;
  setSessionTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  setHarnessSegments: React.Dispatch<React.SetStateAction<MessageSegment[]>>;
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
  setStreamingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  setThinkingContent: React.Dispatch<React.SetStateAction<string>>;
  setAutoRoutedModel: React.Dispatch<React.SetStateAction<AutoRoutedInfo | null>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;

  // ── Collaborators ───────────────────────────────────────────────────────
  scheduleStreamingContentUpdate: (next: string) => void;
  flushStreamingContentUpdate: () => void;
  finishStreamingTurn: () => void;
  appendToDisplayedMessages: (message: ChatMessage) => void;
  getContextLimit: (modelId: string) => number;
  evaluatePermission: (
    server: string,
    toolName: string,
    args: Record<string, unknown>
  ) => PermissionDecision;
  requestGlobalAccess: (toolName: string) => Promise<boolean>;
}

export interface StreamHandlers {
  agentChat: ReturnType<typeof useAgentChat>;
  handleStreamDone: () => Promise<void>;
  waitForQuestionAnswer: (question: string) => Promise<string>;
  answerPendingQuestion: (answer: string) => void;
}

export function useStreamHandlers(deps: StreamHandlerDeps): StreamHandlers {
  const {
    conversation,
    conversationStorageScope,
    projectContext,
    currentModel,
    reasoningBudget,
    isMemoryEnabled,
    activeToolCalls,
    settings,
    fullContentRef,
    screenshotUrlsRef,
    optimisticAssistantIdRef,
    activeConversationIdRef,
    latestStreamingContentRef,
    thinkingContentRef,
    harnessSegmentsRef,
    pendingSegmentTextRef,
    pendingQuestionResolveRef,
    pendingQuestionSegmentIdRef,
    pendingApprovalResolveRef,
    handleStreamDoneRef,
    setConversation,
    setDisplayedMessages,
    setHasMoreMessages,
    setMessageOffset,
    setActiveToolCalls,
    setSessionTasks,
    setHarnessSegments,
    setStreamingContent,
    setStreamingMessageId,
    setThinkingContent,
    setAutoRoutedModel,
    setIsLoading,
    setIsStreaming,
    setError,
    scheduleStreamingContentUpdate,
    flushStreamingContentUpdate,
    finishStreamingTurn,
    appendToDisplayedMessages,
    getContextLimit,
    evaluatePermission,
    requestGlobalAccess,
  } = deps;

  const waitForQuestionAnswer = useCallback((question: string) => {
    const segmentId = `question-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    pendingQuestionSegmentIdRef.current = segmentId;
    harnessSegmentsRef.current = [
      ...harnessSegmentsRef.current,
      { type: "user_question", id: segmentId, question },
    ];
    setHarnessSegments([...harnessSegmentsRef.current]);
    return new Promise<string>((resolve) => {
      pendingQuestionResolveRef.current = resolve;
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const agentChat = useAgentChat(conversation?.id ?? null, {
    onChunk(text) {
      fullContentRef.current += text;
      pendingSegmentTextRef.current += text;
      // Strip DSML markup before showing — some models emit tool calls as raw
      // DSML text; we intercept them in handleStreamDone, so never show them
      // in the live stream.
      const display = hasDSML(pendingSegmentTextRef.current)
        ? stripDSMLForStreaming(pendingSegmentTextRef.current)
        : pendingSegmentTextRef.current;
      scheduleStreamingContentUpdate(display);
    },

    onDone() {
      handleStreamDone();
    },

    onError(msg) {
      logger.warn("ChatProvider", "Agent error event", { msg });
      setError(msg);
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingContent("");
      latestStreamingContentRef.current = "";
      setStreamingMessageId(null);
      setActiveToolCalls([]);
      // Remove the empty optimistic assistant placeholder so the error is visible
      const optId = optimisticAssistantIdRef.current;
      if (optId) {
        setDisplayedMessages((prev) =>
          prev.filter((m) => !(m.id === optId && !m.content))
        );
      }
    },

    onThinking() {
      // isStreaming already set; loading indicator handles this
    },

    onThinkingDelta(chunk) {
      thinkingContentRef.current += chunk;
      setThinkingContent(thinkingContentRef.current);
    },

    onAutoRouted(info) {
      setAutoRoutedModel(info);
    },

    onVisionSubstitutions(_subs) {
      // Presigned URLs are embedded in the messages returned by the agent;
      // the client doesn't need to update local state for WebSocket path.
    },

    onToolStart(callId, tool, args) {
      const dc = classifyToolDisplay(tool);
      setActiveToolCalls((prev) => [
        ...prev,
        {
          callId, tool, args, status: "running",
          displayClass: dc,
          ...(tool === "spawn_agent" ? { type: "sub_agent" as const } : {}),
        },
      ]);

      // Harness tools: flush pending text and insert a running segment
      if (dc === "stream") {
        const pendingText = pendingSegmentTextRef.current;
        if (pendingText) {
          harnessSegmentsRef.current = [
            ...harnessSegmentsRef.current,
            { type: "text", content: pendingText },
          ];
          pendingSegmentTextRef.current = "";
          latestStreamingContentRef.current = "";
          setStreamingContent("");
        }
        harnessSegmentsRef.current = [
          ...harnessSegmentsRef.current,
          { type: "harness_event", event: buildHarnessEvent(callId, tool, args, "running") },
        ];
        setHarnessSegments([...harnessSegmentsRef.current]);
      }
    },

    onToolComplete(callId, tool, result) {
      setActiveToolCalls((prev) =>
        prev.map((tc) =>
          tc.callId === callId ? { ...tc, status: "complete", result } : tc
        )
      );
      // Surface sub-agent lifecycle in the notification center.
      if (tool === "spawn_agent" || tool === "await_agents") {
        recordAgentToolResult(tool, result, activeConversationIdRef.current);
      }
      if (tool === "task_write") {
        const r = result as Record<string, unknown>;
        if (Array.isArray(r?.todos)) setSessionTasks(r.todos as TaskItem[]);
      }
      // Update the corresponding harness segment (server-side tool completions)
      if (classifyToolDisplay(tool) === "stream") {
        harnessSegmentsRef.current = harnessSegmentsRef.current.map((seg) => {
          if (seg.type === "harness_event" && seg.event.callId === callId) {
            return {
              type: "harness_event" as const,
              event: buildHarnessEvent(callId, tool, seg.event.args, "complete", result),
            };
          }
          return seg;
        });
        setHarnessSegments([...harnessSegmentsRef.current]);
      }
    },

    onReconnecting(attempt) {
      logger.warn("ChatProvider", `WS reconnecting, attempt ${attempt}`);
    },

    onReconnected() {
      logger.warn("ChatProvider", "WS reconnected — fiber resuming");
    },

    async onLocalToolsPending(toolCalls, pendingSpecialist): Promise<ToolResultItem[]> {
      const { toolResultItems } = await executeLocalTools(
        toolCalls,
        buildToolExecutionCallbacks({
          setActiveToolCalls,
          setSessionTasks,
          waitForAnswer: waitForQuestionAnswer,
          evaluatePermission,
          requestGlobalAccess,
          pendingApprovalResolveRef,
          screenshotUrls: screenshotUrlsRef.current,
          workspaceRoot: projectContext?.path ?? null,
          convId: conversation?.id,
        })
      );
      void pendingSpecialist; // echoed back by the hook automatically
      return toolResultItems;
    },
  });

  // ── Sync locally-executed harness tool completions into segments ────────
  // onToolComplete only fires for server-side tools. Local harness tools (run
  // via executeLocalTools / invokeMcpTool) update activeToolCalls directly.
  // This effect bridges that gap by watching for status transitions.
  const prevActiveToolCallsRef = useRef<ActiveToolCall[]>([]);
  useEffect(() => {
    const prev = prevActiveToolCallsRef.current;
    let changed = false;
    for (const tc of activeToolCalls) {
      if (tc.displayClass !== "stream") continue;
      const prevTc = prev.find((p) => p.callId === tc.callId);
      if (!prevTc) continue; // just registered — already handled in onToolStart
      if (prevTc.status === "running" && (tc.status === "complete" || tc.status === "error")) {
        harnessSegmentsRef.current = harnessSegmentsRef.current.map((seg) => {
          if (seg.type === "harness_event" && seg.event.callId === tc.callId) {
            return {
              type: "harness_event" as const,
              event: buildHarnessEvent(tc.callId, tc.tool, tc.args, tc.status as "complete" | "error", tc.result),
            };
          }
          return seg;
        });
        changed = true;
      }
    }
    if (changed) setHarnessSegments([...harnessSegmentsRef.current]);
    prevActiveToolCallsRef.current = activeToolCalls;
  }, [activeToolCalls]); // eslint-disable-line react-hooks/exhaustive-deps

  const answerPendingQuestion = useCallback((answer: string) => {
    const trimmed = answer.trim();
    if (!trimmed) return;

    const segmentId = pendingQuestionSegmentIdRef.current;
    if (segmentId) {
      harnessSegmentsRef.current = harnessSegmentsRef.current.map((seg) =>
        seg.type === "user_question" && seg.id === segmentId
          ? { ...seg, answer: trimmed }
          : seg
      );
      setHarnessSegments([...harnessSegmentsRef.current]);
    }

    pendingQuestionSegmentIdRef.current = null;
    pendingQuestionResolveRef.current?.(trimmed);
    pendingQuestionResolveRef.current = null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Stream done handler ─────────────────────────────────────────────────
  const handleStreamDone = useCallback(async () => {
    const convId  = activeConversationIdRef.current;
    const content = fullContentRef.current;
    const optId   = optimisticAssistantIdRef.current;

    flushStreamingContentUpdate();

    if (!content.trim()) {
      setError("The AI returned an empty response. Please try again.");
      setIsStreaming(false);
      setStreamingContent("");
      latestStreamingContentRef.current = "";
      setActiveToolCalls([]);
      return;
    }

    // ── DSML tool-call interception ──────────────────────────────────────────
    // Some models emit tool calls as inline DSML/XML text rather than using
    // structured tool_use API blocks. The DO streams this as plain text.
    // We detect it here, execute the tools locally, then auto-continue the
    // turn so the model gets the results and can give a real answer.
    if (hasDSML(content)) {
      const { cleaned, toolCalls } = parseDSML(content);

      if (toolCalls.length > 0) {
        // 1. Show the text portion (before the DSML block, if any)
        if (cleaned.trim()) {
          harnessSegmentsRef.current = [
            ...harnessSegmentsRef.current,
            { type: "text", content: cleaned },
          ];
        }
        pendingSegmentTextRef.current  = "";
        latestStreamingContentRef.current = "";
        setStreamingContent("");

        // 2. Add a "running" harness card for each tool call
        for (const tc of toolCalls) {
          harnessSegmentsRef.current = [
            ...harnessSegmentsRef.current,
            { type: "harness_event", event: buildHarnessEvent(tc.callId, tc.tool, tc.args, "running") },
          ];
        }
        setHarnessSegments([...harnessSegmentsRef.current]);

        // 3. Execute the tools via the standard local pipeline
        const { toolResultItems } = await executeLocalTools(
          toolCalls,
          buildToolExecutionCallbacks({
            setActiveToolCalls,
            setSessionTasks,
            waitForAnswer: waitForQuestionAnswer,
            evaluatePermission,
            requestGlobalAccess,
            pendingApprovalResolveRef,
            screenshotUrls: screenshotUrlsRef.current,
            workspaceRoot: projectContext?.path ?? null,
            convId: conversation?.id,
          })
        );

        // 4. Update the harness cards to "complete"
        harnessSegmentsRef.current = harnessSegmentsRef.current.map((seg) => {
          if (seg.type !== "harness_event") return seg;
          const tc = toolCalls.find((t) => t.callId === seg.event.callId);
          if (!tc) return seg;
          const ri = toolResultItems.find((r) => r.call_id === tc.callId);
          return {
            type: "harness_event" as const,
            event: buildHarnessEvent(tc.callId, tc.tool, tc.args, "complete", ri?.content),
          };
        });
        setHarnessSegments([...harnessSegmentsRef.current]);

        // 5. Build the continuation context:
        //    [conversation history] + [synthetic assistant tool_use] + [tool results]
        const runningMcpServers = await getMcpServers(conversationStorageScope);

        const ctxMsgs = await getContextMessages(convId, MAX_CONTEXT_MESSAGES);
        const apiMessages: APIChatMessage[] = ctxMsgs.map((m) => ({
          role: m.role, content: m.content,
        }));

        // Synthetic assistant message carrying the tool_calls
        apiMessages.push({
          role: "assistant",
          content: cleaned || "",
          tool_calls: toolCalls.map((tc) => ({
            id: tc.callId,
            type: "function" as const,
            function: { name: tc.tool, arguments: JSON.stringify(tc.args) },
          })),
        } as APIChatMessage);

        // Tool result messages
        for (const r of toolResultItems) {
          apiMessages.push({
            role:         "tool",
            content:      r.content,
            tool_call_id: r.call_id,
            name:         r.name,
          } as APIChatMessage);
        }

        // Apply system prompts + prune to model context limit
        const enhanced = applyAllSystemMessages(
          apiMessages, runningMcpServers,
          settings.imageModel, settings.videoModel, projectContext
        );
        const prunedMessages = pruneContextByTokens(enhanced, getContextLimit(currentModel));

        // 6. Re-use the same optimistic assistant slot for the continuation response
        //    (replaces the blank placeholder rather than adding a second bubble)
        const continuationId = `ai-dsml-${Date.now()}`;
        optimisticAssistantIdRef.current = continuationId;
        fullContentRef.current           = "";
        pendingSegmentTextRef.current    = "";
        latestStreamingContentRef.current = "";
        setStreamingContent("");
        setStreamingMessageId(continuationId);
        setDisplayedMessages((prev) =>
          prev.map((m) => m.id === optId ? { ...m, id: continuationId, content: "" } : m)
        );

        // 7. Start the continuation turn — handleStreamDone fires again when done
        agentChat.startTurn(buildChatBody({
          messages: prunedMessages,
          model: currentModel,
          runningMcpServers,
          storageScope: conversationStorageScope,
          reasoningBudget,
        }), convId);

        return; // normal handleStreamDone path runs after the continuation finishes
      }
    }
    // ── End DSML interception ────────────────────────────────────────────────

    const parsed = parseChatResponse(content);
    const finalContent = parsed?.trim() ? parsed : content.trim();

    // Flush any text that arrived after the last harness tool event
    if (pendingSegmentTextRef.current.trim()) {
      harnessSegmentsRef.current = [
        ...harnessSegmentsRef.current,
        { type: "text", content: pendingSegmentTextRef.current },
      ];
    }
    const finalSegments = harnessSegmentsRef.current.length > 0
      ? [...harnessSegmentsRef.current]
      : undefined;

    const screenshotUrls = screenshotUrlsRef.current;
    const capturedThinking = thinkingContentRef.current.trim();
    const assistantMsg: any = {
      id:        optId,
      timestamp: Date.now(),
      role:      "assistant",
      content:   finalContent,
      ...(screenshotUrls.length > 0 ? { imageUrls: [...screenshotUrls] } : {}),
      ...(finalSegments ? { segments: finalSegments } : {}),
      ...(capturedThinking ? { thinkingContent: capturedThinking } : {}),
    };

    if (isClaudeOwnedConversation(conversation)) {
      const finalConv = await loadConversation(convId);
      if (finalConv) {
        setConversation(finalConv);
        setDisplayedMessages(finalConv.messages.slice(-MESSAGES_PER_PAGE));
        setHasMoreMessages(finalConv.messages.length > MESSAGES_PER_PAGE);
        setMessageOffset(MESSAGES_PER_PAGE);
      }

      finishStreamingTurn();
      return;
    }

    await addMessage(convId, assistantMsg);
    const finalConv = await loadConversation(convId);
    if (finalConv) {
      setConversation(finalConv);
      const last = finalConv.messages[finalConv.messages.length - 1];
      if (last?.role === "assistant") {
        appendToDisplayedMessages(last);
      }
      // Background memory processing
      if (isMemoryEnabled) {
        memorySystem.processConversation(finalConv).catch(() => {});
      }
    }

    finishStreamingTurn();
  }, [flushStreamingContentUpdate, isMemoryEnabled, appendToDisplayedMessages, conversationStorageScope, finishStreamingTurn]); // eslint-disable-line

  useEffect(() => {
    handleStreamDoneRef.current = handleStreamDone;
  }, [handleStreamDone]); // eslint-disable-line react-hooks/exhaustive-deps

  return { agentChat, handleStreamDone, waitForQuestionAnswer, answerPendingQuestion };
}
