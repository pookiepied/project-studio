import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { buildChatBody, executeLocalTools, getMcpServers } from "@/runtime";
import type { ChatRequestBody } from "@/runtime";
import { buildHarnessEvent } from "@/lib/harnessEventUtils";
import { hasDSML, parseDSML } from "@/lib/dsmlParser";
import { getContextMessages } from "@/features/chat/conversations/chatHistoryService";
import type { ConversationStorageScope } from "@/core/conversations";
import type { ManagementKind, PermissionDecision } from "@/core/permissions";
import { applyAllSystemMessages, pruneContextByTokens } from "./messageBuilder";
import { buildToolExecutionCallbacks } from "./toolExecutionCallbacks";
import { MAX_CONTEXT_MESSAGES } from "./constants";
import type { ActiveToolCall, TaskItem, ToolApprovalDecision } from "./types";
import type { ProjectCtx } from "./projectContextStorage";
import type { ChatMessage, MessageSegment } from "@/types";
import type { APIChatMessage } from "@/types/chat";

type AgentChatStarter = { startTurn: (body: ChatRequestBody, convId?: string) => void };

interface HandleDsmlContinuationDeps {
  content: string;
  convId: string;
  optimisticAssistantId: string;
  agentChat: AgentChatStarter;
  conversationId: string | undefined;
  conversationStorageScope: ConversationStorageScope;
  projectContext: ProjectCtx | null;
  currentModel: string;
  reasoningBudget: number | undefined;
  settings: { imageModel?: string; videoModel?: string };
  fullContentRef: MutableRefObject<string>;
  screenshotUrlsRef: MutableRefObject<string[]>;
  optimisticAssistantIdRef: MutableRefObject<string>;
  latestStreamingContentRef: MutableRefObject<string>;
  harnessSegmentsRef: MutableRefObject<MessageSegment[]>;
  pendingSegmentTextRef: MutableRefObject<string>;
  pendingApprovalResolveRef: MutableRefObject<((d: ToolApprovalDecision) => void) | null>;
  setDisplayedMessages: Dispatch<SetStateAction<ChatMessage[]>>;
  setActiveToolCalls: Dispatch<SetStateAction<ActiveToolCall[]>>;
  setSessionTasks: Dispatch<SetStateAction<TaskItem[]>>;
  setHarnessSegments: Dispatch<SetStateAction<MessageSegment[]>>;
  setStreamingContent: Dispatch<SetStateAction<string>>;
  setStreamingMessageId: Dispatch<SetStateAction<string | null>>;
  waitForQuestionAnswer: (question: string) => Promise<string>;
  evaluatePermission: (
    server: string,
    toolName: string,
    args: Record<string, unknown>
  ) => PermissionDecision;
  requestGlobalAccess: (toolName: string) => Promise<boolean>;
  requestManagementAccess: (kind: ManagementKind) => Promise<boolean>;
  getContextLimit: (modelId: string) => number;
}

export async function handleDsmlContinuation({
  content,
  convId,
  optimisticAssistantId,
  agentChat,
  conversationId,
  conversationStorageScope,
  projectContext,
  currentModel,
  reasoningBudget,
  settings,
  fullContentRef,
  screenshotUrlsRef,
  optimisticAssistantIdRef,
  latestStreamingContentRef,
  harnessSegmentsRef,
  pendingSegmentTextRef,
  pendingApprovalResolveRef,
  setDisplayedMessages,
  setActiveToolCalls,
  setSessionTasks,
  setHarnessSegments,
  setStreamingContent,
  setStreamingMessageId,
  waitForQuestionAnswer,
  evaluatePermission,
  requestGlobalAccess,
  requestManagementAccess,
  getContextLimit,
}: HandleDsmlContinuationDeps): Promise<boolean> {
  if (!hasDSML(content)) return false;

  const { cleaned, toolCalls } = parseDSML(content);
  if (toolCalls.length === 0) return false;

  if (cleaned.trim()) {
    harnessSegmentsRef.current = [
      ...harnessSegmentsRef.current,
      { type: "text", content: cleaned },
    ];
  }
  pendingSegmentTextRef.current = "";
  latestStreamingContentRef.current = "";
  setStreamingContent("");

  for (const tc of toolCalls) {
    harnessSegmentsRef.current = [
      ...harnessSegmentsRef.current,
      { type: "harness_event", event: buildHarnessEvent(tc.callId, tc.tool, tc.args, "running") },
    ];
  }
  setHarnessSegments([...harnessSegmentsRef.current]);

  const { toolResultItems } = await executeLocalTools(
    toolCalls,
    buildToolExecutionCallbacks({
      setActiveToolCalls,
      setSessionTasks,
      waitForAnswer: waitForQuestionAnswer,
      evaluatePermission,
      requestGlobalAccess,
      requestManagementAccess,
      pendingApprovalResolveRef,
      screenshotUrls: screenshotUrlsRef.current,
      workspaceRoot: projectContext?.path ?? null,
      convId: conversationId,
    })
  );

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

  const runningMcpServers = await getMcpServers(conversationStorageScope);
  const ctxMsgs = await getContextMessages(convId, MAX_CONTEXT_MESSAGES);
  const apiMessages: APIChatMessage[] = ctxMsgs.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  apiMessages.push({
    role: "assistant",
    content: cleaned || "",
    tool_calls: toolCalls.map((tc) => ({
      id: tc.callId,
      type: "function" as const,
      function: { name: tc.tool, arguments: JSON.stringify(tc.args) },
    })),
  } as APIChatMessage);

  for (const r of toolResultItems) {
    apiMessages.push({
      role: "tool",
      content: r.content,
      tool_call_id: r.call_id,
      name: r.name,
    } as APIChatMessage);
  }

  const enhanced = applyAllSystemMessages(
    apiMessages,
    runningMcpServers,
    settings.imageModel,
    settings.videoModel,
    projectContext
  );
  const prunedMessages = pruneContextByTokens(enhanced, getContextLimit(currentModel));

  const continuationId = `ai-dsml-${Date.now()}`;
  optimisticAssistantIdRef.current = continuationId;
  fullContentRef.current = "";
  pendingSegmentTextRef.current = "";
  latestStreamingContentRef.current = "";
  setStreamingContent("");
  setStreamingMessageId(continuationId);
  setDisplayedMessages((prev) =>
    prev.map((m) => m.id === optimisticAssistantId ? { ...m, id: continuationId, content: "" } : m)
  );

  agentChat.startTurn(buildChatBody({
    messages: prunedMessages,
    model: currentModel,
    runningMcpServers,
    storageScope: conversationStorageScope,
    reasoningBudget,
  }), convId);

  return true;
}
