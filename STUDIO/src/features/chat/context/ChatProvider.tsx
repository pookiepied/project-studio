/**
 * ChatProvider — lean state coordinator.
 *
 * Previously a 2358-line monolith. Now a thin provider that delegates:
 *   - Type definitions         → types.ts
 *   - Constants / sets         → constants.ts
 *   - Tool classification      → toolClassifier.ts
 *   - Local tool execution     → toolExecutor.ts
 *   - Message pipeline         → messageBuilder.ts
 *   - Context compaction       → contextCompactor.ts
 *   - WebSocket streaming      → useAgentChat (hooks/)
 *   - AI HTTP calls (non-chat) → services/ai/*
 */

import {
  createContext,
  useContext,
  ReactNode,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { buildChatBody, getMcpServers } from "@/runtime";
import { buildSendContext } from "./buildSendContext";

import type { ChatConversation, ChatMessage }          from "@/types";
import type { FileAttachment }                         from "@/services/files/fileAttachmentService";
import type { APIChatMessage, ToolResultItem, AutoRoutedInfo } from "@/types/chat";
import { extractMessageText }                          from "@/types/chat";
import { aiService }                                   from "@/services/ai/aiService";
import { tokenManager }                                from "@/utils/tokenManager";
import { memorySystem }                                from "@/services/storage/memorySystem";
import { errorService }                                from "@/services/errors/errorService";
import { logger }                                      from "@/services/logging/logger";
import { safeIsVisionModel, safeGetContextWindow, handleNetworkFailure } from "@/services/network/fallbackService";
import { useSettings }                                 from "@/contexts/SettingsContext";
import { useModelsContext as useModels }                from "@/features/models/context";
import { parseChatResponse, isValidChatResponse }     from "@/utils/chatParser";
import { TAURI_CONFIG }                               from "@/config/tauriConfig";
import {
  createConversation, saveConversation, loadConversation, addMessage,
  getContextMessages, getConversationMessages, updateConversationTitle,
  updateMessage, deleteMessage, getAllConversations, truncateMessagesAfter,
  forkConversationToStudio as forkConversationToStudioStorage,
} from "@/services/storage/chatHistoryService";
import type { ConversationStorageScope } from "@/services/storage/chatHistoryService";
import {
  canContinueWithEngine,
  isClaudeOwnedConversation,
  normalizeEngineForConversationOwner,
} from "@/services/conversations/ownership/conversationOwnership";
import {
  getPreferredChatEngine,
  savePreferredChatEngine,
} from "@/services/conversations/preferences/chatEnginePreference";

import { useAgentChat }                                from "@/runtime";
import { useVoiceInput }                               from "@/hooks/useVoiceInput";
import { usePermittedTools }                           from "@/features/chat/hooks/usePermittedTools";

import type { MessageSegment } from "@/types";
import type { ChatContextType, ActiveToolCall, TaskItem } from "./types";
import { DEFAULT_MAX_CONTEXT_TOKENS, MESSAGES_PER_PAGE, MAX_CONTEXT_MESSAGES } from "./constants";
import { classifyToolDisplay, extractGeneratedImageIds, deleteRemoteImages } from "@/runtime";
import { buildHarnessEvent } from "@/utils/harnessEventUtils";
import { hasDSML, parseDSML, stripDSMLForStreaming } from "@/utils/dsmlParser";
import { executeLocalTools }                           from "@/runtime";
import {
  buildApiMessages, pruneContextByTokens, applyAllSystemMessages,
} from "./messageBuilder";
import { maybeCompact }                                from "./contextCompactor";
import { applyCatchUp }                               from "./catchUp";
import { fetchPendingCompletion, clearPendingCompletion } from "@/services/ai/pendingCompletion";
import { chat } from "@/services/ai/chatService";
import { claudeBridgeService } from "@/services/ai/claudeBridgeService";
import type { ChatEngine, ClaudeEffortLevel } from "@/cliBridges/types";
import { effortToThinkingBudget, getClaudeContextWindowTokens } from "@/cliBridges";
import type { PermissionModeId, PermissionDecision, ActionMode } from "@/permissions";
import {
  evaluateToolCall,
  chatModeFromStorageScope,
  deriveLocalContext,
  getWorkspaceTrust,
  hasGlobalGrant,
  setGlobalGrant,
  buildGrantLookupForConversation,
  clearSessionGrants,
  recordGrant as recordToolGrant,
} from "@/permissions";
import { readLocalMcpPermission, getLocalMcpServer } from "@/runtime";
import { GlobalAccessModal } from "@/components/overlays/GlobalAccessModal";
import type { ToolApprovalDecision } from "./types";

import {
  getConvProjectCtx,
  saveConvProjectCtx,
  type ProjectCtx,
} from "./projectContextStorage";
import { backgroundSessionTracker } from "@/services/conversations/backgroundSessionTracker";
import { NotificationService, recordAgentToolResult } from "@/services/notifications";
import type { PendingMessage } from "./types";
import type { ClaudeSessionMetadata } from "@/types";
import { getAIMode } from "@/config/autoMode";

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const ChatContext = createContext<ChatContextType | null>(null);

export function useChatContext(): ChatContextType {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error("useChat must be used within ChatProvider");
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function ChatProvider({ children }: { children: ReactNode }) {
  const { settings }  = useSettings();
  const { models }    = useModels();

  // Declared early so getContextLimit can reference it without a TDZ error.
  const [autoRoutedModel,  setAutoRoutedModel]  = useState<AutoRoutedInfo | null>(null);

  // ── Context-limit calculator ────────────────────────────────────────────
  const getContextLimit = useCallback((modelId: string): number => {
    try {
      const normalizedModelId = getAIMode(modelId)?.modelId ?? modelId;
      if (/^(claude-|sonnet$|opus$|haiku$|fable$)/i.test(normalizedModelId)) {
        return getClaudeContextWindowTokens(normalizedModelId);
      }
      if (!models.length) return DEFAULT_MAX_CONTEXT_TOKENS;
      // Virtual routing names ("auto", "fast", etc.) don't have entries in the models list.
      // Use the last resolved model if known; otherwise return a generous default.
      if (
        normalizedModelId === "auto" ||
        normalizedModelId === "fast" ||
        normalizedModelId === "standard" ||
        normalizedModelId === "advanced"
      ) {
        const resolved = autoRoutedModel?.model;
        if (resolved) return Math.floor(safeGetContextWindow(models, resolved) * 0.75);
        return 200_000;
      }
      const detectedLimit = safeGetContextWindow(models, normalizedModelId);
      if (detectedLimit > DEFAULT_MAX_CONTEXT_TOKENS) return Math.floor(detectedLimit * 0.75);
      if (/^(openrouter:|openai:|anthropic:|google:|groq:)/i.test(normalizedModelId)) {
        return 200_000;
      }
      return Math.floor(detectedLimit * 0.75);
    } catch {
      return DEFAULT_MAX_CONTEXT_TOKENS;
    }
  }, [models, autoRoutedModel]);

  // ── Core state ─────────────────────────────────────────────────────────
  const [conversation,       setConversation]       = useState<ChatConversation | null>(null);
  const [isLoading,          setIsLoading]          = useState(false);
  const [isStreaming,        setIsStreaming]         = useState(false);

  // ── Pending message queue ───────────────────────────────────────────────
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const sendMessageRef = useRef<((content: string, useStreaming?: boolean, attachments?: import("@/services/files/fileAttachmentService").FileAttachment[]) => Promise<void>) | null>(null);
  const [streamingContent,   setStreamingContent]   = useState("");
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  // isRecordingVoice + voice send/transcribe come from useVoiceInput (below sendMessage)
  const [error,              setError]              = useState<string | null>(null);
  const [currentModel,       setCurrentModel]       = useState(settings.defaultChatModel || "auto");
  const [conversationStorageScope, setConversationStorageScopeState] = useState<ConversationStorageScope>("cloud");
  const [chatEngine,       setChatEngineState]  = useState<ChatEngine>("studio");
  const [claudeModel,         setClaudeModelState]    = useState("sonnet");
  const [claudeSession,      setClaudeSession]      = useState<ClaudeSessionMetadata | null>(null);
  const [claudePermissionMode, setClaudePermissionModeState] = useState<PermissionModeId>("default");
  const [claudeEffortLevel,    setClaudeEffortLevelState]    = useState<ClaudeEffortLevel>("medium");
  const [isMemoryEnabled,    setIsMemoryEnabled]    = useState(false);
  const [thinkingContent,    setThinkingContent]    = useState("");
  const [reasoningBudget,    setReasoningBudget]    = useState<number | undefined>(undefined);

  // ── Lazy loading ────────────────────────────────────────────────────────
  const [displayedMessages, setDisplayedMessages] = useState<ChatMessage[]>([]);
  const [hasMoreMessages,   setHasMoreMessages]   = useState(false);
  const [isLoadingMore,     setIsLoadingMore]      = useState(false);
  const [messageOffset,     setMessageOffset]      = useState(0);

  // ── Tool / interaction state ────────────────────────────────────────────
  const [messageToolCalls, setMessageToolCalls] = useState<Map<string, string[]>>(new Map());
  const [activeToolCalls,  setActiveToolCalls]  = useState<ActiveToolCall[]>([]);
  const [sessionTasks,     setSessionTasks]     = useState<TaskItem[]>([]);

  // ── Context health ──────────────────────────────────────────────────────
  const [isSummarizing,  setIsSummarizing]  = useState(false);
  const [contextTokens,  setContextTokens]  = useState(0);
  const [contextLimit,   setContextLimit]   = useState(DEFAULT_MAX_CONTEXT_TOKENS);

  // Real context-window occupancy from the model's own usage accounting rather
  // than a tokenizer estimate. Sum of the input components (fresh + cache) is
  // the true prompt size — system prompt, skills, tools, and all file-read
  // results included. Derived from the persisted Claude session so it restores
  // per-conversation. 0 when no real usage yet (UI falls back to the estimate).
  const usageContextTokens = useMemo(() => {
    if (chatEngine === "claude" && claudeSession) {
      return (claudeSession.lastInputTokens ?? 0)
        + (claudeSession.lastCacheReadTokens ?? 0)
        + (claudeSession.lastCacheCreationTokens ?? 0);
    }
    return 0;
  }, [chatEngine, claudeSession]);

  // ── Project context ─────────────────────────────────────────────────────
  // Per-conversation: each conversation stores its own folder.
  // New chats always start empty; loading a conversation restores its saved folder.
  const [projectContext, setProjectContextState] = useState<ProjectCtx | null>(null);
  // Holds the folder chosen in a new chat before the first message creates a conversation ID.
  const pendingProjectContextRef = useRef<ProjectCtx | null>(null);

  const setProjectContext = useCallback((ctx: ProjectCtx | null) => {
    if (conversationStorageScope === "cloud" && ctx) return;
    setProjectContextState(ctx);
    if (conversation?.id) {
      saveConvProjectCtx(conversation.id, ctx);
      if (!isClaudeOwnedConversation(conversation)) {
        const updatedConversation: ChatConversation = {
          ...conversation,
          updatedAt: Date.now(),
          metadata: {
            ...(conversation.metadata ?? {}),
            ...(ctx ? { project: ctx } : { project: undefined }),
          },
        };
        saveConversation(updatedConversation).catch(() => {});
        setConversation(updatedConversation);
      }
    } else {
      // No conversation yet — keep pending; it will be persisted when the
      // conversation is created on first message send.
      pendingProjectContextRef.current = ctx;
    }
  }, [conversation, conversationStorageScope]);

  // ── Workspace trust ──────────────────────────────────────────────────────
  // Trust is recorded by ProjectContextPicker when a folder is first opened (it
  // owns the trust/working-style modal). Here we only *read* it, below, to gate
  // mutating tool calls via the permission engine.

  // ── Global machine-access gate ────────────────────────────────────────────
  // Shown when a global (no-project) chat needs to reach files outside any
  // workspace. Granting persists a durable machine-wide grant; declining blocks
  // the call. Fires lazily from the tool executor, resolved via a ref like the
  // per-action approval prompt.
  const [globalAccessPrompt, setGlobalAccessPrompt] = useState<{ toolName: string } | null>(null);
  const pendingGlobalAccessResolveRef = useRef<((granted: boolean) => void) | null>(null);

  const resolveGlobalAccess = useCallback((granted: boolean) => {
    if (granted) setGlobalGrant(true, conversation?.id ?? null);
    setGlobalAccessPrompt(null);
    pendingGlobalAccessResolveRef.current?.(granted);
    pendingGlobalAccessResolveRef.current = null;
  }, [conversation?.id]);

  const requestGlobalAccess = useCallback((toolName: string): Promise<boolean> => {
    setGlobalAccessPrompt({ toolName });
    return new Promise<boolean>((resolve) => { pendingGlobalAccessResolveRef.current = resolve; });
  }, []);

  // ── Action-mode freeze (review ↔ autonomous) ────────────────────────────
  // The effective mode is SNAPSHOT at task start and held for the entire task
  // — including every tool-loop continuation — so a mid-run toggle can never
  // flip enforcement partway through a response. The user may toggle as often
  // as they like while a turn runs; the change lands on the NEXT task.
  //
  // `liveActionModeRef` always mirrors the current (desired) mode; the freeze
  // effect copies it on the isStreaming rising edge and clears it when the
  // assistant returns to idle (normal completion, error, or abort all drive
  // isStreaming→false). Reading the live value via a ref avoids a stale
  // closure while keeping [isStreaming] as the only trigger.
  const liveActionModeRef = useRef<ActionMode>("review");
  liveActionModeRef.current =
    projectContext?.accessMode ?? (settings.autopilotMode ? "autonomous" : "review");
  const frozenActionModeRef = useRef<ActionMode | null>(null);
  useEffect(() => {
    if (isStreaming) {
      if (frozenActionModeRef.current === null) {
        frozenActionModeRef.current = liveActionModeRef.current;
      }
    } else {
      frozenActionModeRef.current = null;
    }
  }, [isStreaming]);

  // ── Permission engine — assemble trusted context for a local tool call ───
  const evaluatePermission = useCallback(
    (server: string, toolName: string, args: Record<string, unknown>): PermissionDecision => {
      const workspaceRoot = projectContext?.path ?? null;
      // Frozen mode wins while a task is in flight; otherwise use the live mode.
      const actionMode: ActionMode =
        frozenActionModeRef.current ?? liveActionModeRef.current;
      const def = getLocalMcpServer(server);
      return evaluateToolCall({
        chatMode:       chatModeFromStorageScope(conversationStorageScope),
        localContext:   deriveLocalContext(conversationStorageScope, !!projectContext),
        server,
        toolName,
        args,
        mcpEnabled:     def ? readLocalMcpPermission(def) === true : false,
        workspaceRoot,
        workspaceTrust: getWorkspaceTrust(workspaceRoot),
        grantedRoots:   workspaceRoot ? [workspaceRoot] : [],
        hasGlobalGrant: hasGlobalGrant(conversation?.id ?? null),
        actionMode,
        existingGrants: buildGrantLookupForConversation(workspaceRoot, conversation?.id ?? null),
      });
    },
    [conversationStorageScope, conversation?.id, projectContext]
  );

  const persistConversationMetadata = useCallback(async (
    conv: ChatConversation,
    provider: ChatEngine,
    nextClaude?: ClaudeSessionMetadata | null
  ) => {
    const updatedConv: ChatConversation = {
      ...conv,
      updatedAt: Date.now(),
      metadata: {
        ...(conv.metadata ?? {}),
        provider,
        ...(nextClaude ? { claude: nextClaude } : {}),
      },
    };
    if (!isClaudeOwnedConversation(updatedConv)) {
      await saveConversation(updatedConv);
    }
    setConversation(updatedConv);
    setChatEngineState(provider);
    if (updatedConv.metadata?.storageScope === "local") {
      savePreferredChatEngine(provider, updatedConv.id);
    }
    setClaudeSession(nextClaude ?? updatedConv.metadata?.claude ?? null);
    if (nextClaude?.model) setClaudeModelState(nextClaude.model);
    return updatedConv;
  }, []);

  const setChatEngine = useCallback((mode: ChatEngine, options: { persist?: boolean } = {}) => {
    if (conversationStorageScope === "cloud" && mode !== "studio") return;
    if (conversation && !canContinueWithEngine(conversation.metadata, mode)) {
      setError("This is a Claude Code native conversation. Continue with Claude, or fork it into a Studio conversation first.");
      return;
    }
    setChatEngineState(mode);
    setContextLimit(getContextLimit(mode === "claude" ? claudeModel : currentModel));
    if (conversationStorageScope === "local" && options.persist !== false) {
      savePreferredChatEngine(mode, conversation?.id ?? null);
    }
    if (!conversation) return;
    const nextConversation: ChatConversation = {
      ...conversation,
      updatedAt: Date.now(),
      metadata: {
        ...(conversation.metadata ?? {}),
        provider: mode,
      },
    };
    if (!isClaudeOwnedConversation(nextConversation)) {
      saveConversation(nextConversation).catch(() => {});
    }
    setConversation(nextConversation);
  }, [conversation, conversationStorageScope, setError, claudeModel, currentModel, getContextLimit]);

  const setConversationStorageScope = useCallback((scope: ConversationStorageScope) => {
    setConversationStorageScopeState(scope);
    if (scope === "cloud") {
      setChatEngineState("studio");
      setContextLimit(getContextLimit(currentModel));
    } else {
      const preferredEngine = getPreferredChatEngine() ?? "studio";
      setChatEngineState(preferredEngine);
      setContextLimit(getContextLimit(preferredEngine === "claude" ? claudeModel : currentModel));
    }
    setProjectContextState(null);
    pendingProjectContextRef.current = null;
  }, [claudeModel, currentModel, getContextLimit]);

  const setClaudeModel = useCallback((model: string) => {
    setClaudeModelState(model);
    setContextLimit(getContextLimit(model));
    setClaudeSession((prev) => {
      const next = { ...(prev ?? {}), model };
      if (conversation) {
        const nextConversation: ChatConversation = {
          ...conversation,
          updatedAt: Date.now(),
          metadata: {
            ...(conversation.metadata ?? {}),
            claude: {
              ...(conversation.metadata?.claude ?? {}),
              model,
            },
          },
        };
        saveConversation(nextConversation).catch(() => {});
        setConversation(nextConversation);
      }
      return next;
    });
  }, [conversation, getContextLimit]);

  // ── Harness inline segment state ────────────────────────────────────────
  const [harnessSegments, setHarnessSegments] = useState<MessageSegment[]>([]);
  /** Completed interleaved segments built during the current turn. */
  const harnessSegmentsRef   = useRef<MessageSegment[]>([]);
  /** Text accumulated since the last harness tool event (pending segment). */
  const pendingSegmentTextRef = useRef<string>("");

  // ── Refs ────────────────────────────────────────────────────────────────
  const pendingToolCallsRef      = useRef<string[]>([]);
  const agentIdToCallId          = useRef<Map<string, string>>(new Map());
  const pendingQuestionResolveRef = useRef<((a: string) => void) | null>(null);
  const pendingQuestionSegmentIdRef = useRef<string | null>(null);
  const pendingApprovalResolveRef = useRef<((d: ToolApprovalDecision) => void) | null>(null);
  const isSummarizingRef         = useRef(false);
  const abortControllerRef       = useRef<AbortController | null>(null);
  const handleStreamDoneRef      = useRef<(() => Promise<void>) | null>(null);
  // voice refs live in useVoiceInput hook
  const sendMessageForVoiceRef   = useRef<((text: string, streaming?: boolean) => Promise<void>) | null>(null);
  const conversationCreationRef  = useRef<Promise<ChatConversation> | null>(null);
  const latestStreamingContentRef = useRef("");
  const thinkingContentRef       = useRef("");
  const pendingStreamingFrameRef = useRef<number | null>(null);

  // ── Streaming content throttle (rAF) ───────────────────────────────────
  const scheduleStreamingContentUpdate = useCallback((next: string) => {
    latestStreamingContentRef.current = next;
    if (pendingStreamingFrameRef.current !== null) return;
    pendingStreamingFrameRef.current = window.requestAnimationFrame(() => {
      pendingStreamingFrameRef.current = null;
      setStreamingContent(latestStreamingContentRef.current);
    });
  }, []);

  const flushStreamingContentUpdate = useCallback(() => {
    if (pendingStreamingFrameRef.current !== null) {
      window.cancelAnimationFrame(pendingStreamingFrameRef.current);
      pendingStreamingFrameRef.current = null;
    }
    setStreamingContent(latestStreamingContentRef.current);
  }, []);

  useEffect(() => () => {
    if (pendingStreamingFrameRef.current !== null)
      window.cancelAnimationFrame(pendingStreamingFrameRef.current);
  }, []);

  // ── Drain pending message queue when streaming ends ─────────────────────
  const prevIsStreamingRef = useRef(false);
  useEffect(() => {
    const wasStreaming = prevIsStreamingRef.current;
    prevIsStreamingRef.current = isStreaming;
    if (wasStreaming && !isStreaming && pendingMessages.length > 0) {
      const [first, ...rest] = pendingMessages;
      setPendingMessages(rest);
      // Defer one tick so streaming state fully settles before re-entering sendMessage
      setTimeout(() => sendMessageRef.current?.(first.content, true, first.attachments), 0);
    }
  }, [isStreaming, pendingMessages]);

  // ── Sync default model ──────────────────────────────────────────────────
  useEffect(() => {
    if (!conversation && settings.defaultChatModel) setCurrentModel(settings.defaultChatModel);
  }, [settings.defaultChatModel, conversation]);

  useEffect(() => {
    if (!conversation) {
      setChatEngineState(conversationStorageScope === "local" ? getPreferredChatEngine() ?? "studio" : "studio");
      setClaudeSession(null);
      return;
    }
    // "cloud" is a legacy stored value — treat as "claude"
    const raw = conversation.metadata?.provider ?? "studio";
    const nextProvider: ChatEngine = raw === "cloud" ? "claude" : (raw as ChatEngine);
    const nextScope = conversation.metadata?.storageScope ?? "cloud";
    const nextClaude = conversation.metadata?.claude ?? null;
    setConversationStorageScopeState(nextScope);
    const preferredProvider = getPreferredChatEngine(conversation.id) ?? nextProvider;
    setChatEngineState(nextScope === "cloud" ? "studio" : normalizeEngineForConversationOwner(conversation.metadata, preferredProvider));
    setClaudeSession(nextClaude);
    if (nextClaude?.model) setClaudeModelState(nextClaude.model);
    if (nextClaude?.permissionMode) setClaudePermissionModeState(nextClaude.permissionMode as PermissionModeId);
    if (nextClaude?.effortLevel)    setClaudeEffortLevelState(nextClaude.effortLevel as ClaudeEffortLevel);
  // conversation.id/metadata slices used as narrow trigger; full object excluded to avoid excessive re-fire
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.metadata, conversationStorageScope]);

  useEffect(() => {
    const activeModelId = chatEngine === "claude" ? claudeModel : currentModel;
    setContextLimit(getContextLimit(activeModelId));
  }, [chatEngine, claudeModel, currentModel, getContextLimit]);

  // When a new conversation is first created (conversation.id goes from null → new id),
  // persist any project context the user selected before sending the first message.
  useEffect(() => {
    if (conversation?.id && pendingProjectContextRef.current) {
      // Pending project selection is intentionally ephemeral until a real
      // conversation exists. Refreshing an empty chat must not restore it.
      saveConvProjectCtx(conversation.id, pendingProjectContextRef.current);
      pendingProjectContextRef.current = null;
    }
  }, [conversation?.id]);

  // ── Memory init ─────────────────────────────────────────────────────────
  useEffect(() => {
    memorySystem.initialize().catch(() => {});
  }, []);

  // ── Sync notification preference into background tracker ─────────────────
  useEffect(() => {
    if (!settings.showNotifications || !settings.notifyConversationDone) {
      backgroundSessionTracker.setCompletionCallback(() => {});
      return;
    }
    // Ensure permission is granted so notifications can fire when conversations finish
    NotificationService.requestPermission().catch(() => {});
    backgroundSessionTracker.setCompletionCallback((_convId, title) => {
      NotificationService.showConversationDone(title);
    });
    backgroundSessionTracker.setPermissionCallback((_convId, title) => {
      NotificationService.showPermissionNeeded(title);
    });
  }, [settings.showNotifications, settings.notifyConversationDone]);

  // ── Model capabilities ──────────────────────────────────────────────────
  const currentModelSupportsVision = models.length > 0
    ? safeIsVisionModel(models, currentModel)
    : /vision|llava|moondream|gpt-4o|claude-3|gemini.*vision/i.test(currentModel);

  // ── Permission helpers ──────────────────────────────────────────────────
  const { permittedTools, grantToolPermission, revokeToolPermission, resetPermittedTools } = usePermittedTools();

  // ── Load most recent conversation on mount ──────────────────────────────
  const conversationLoadedRef = useRef(false);

  const loadMostRecentConversation = useCallback(async () => {
    if (conversationLoadedRef.current) return;
    const all = await getAllConversations();
    if (all.length > 0) {
      const conv = await loadConversation(all[0].id);
      if (conv) {
        conversationLoadedRef.current = true;
        setConversation(conv);
        setCurrentModel(conv.model);
        await loadInitialMessages(conv.id, conv.messages.length);
        maybeCompact(conv, conv.model, getContextLimit, isSummarizingRef, setIsSummarizing, setConversation).catch(() => {});

        const lastMsg = conv.messages[conv.messages.length - 1];
        if (lastMsg?.role === "user") {
          fetchPendingCompletion(conv.id).then(async (content) => {
            if (!content) return;
            await applyCatchUp(conv.id, content, setConversation, appendToDisplayedMessages);
            clearPendingCompletion(conv.id).catch(() => {});
          }).catch(() => {});
        }
      }
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadMostRecentConversation();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run when cloud storage becomes available (fires after AuthContext enables it)
  useEffect(() => {
    const handler = () => loadMostRecentConversation();
    window.addEventListener('studio:storage-ready', handler);
    return () => window.removeEventListener('studio:storage-ready', handler);
  }, [loadMostRecentConversation]);

  // ── WebSocket chat hook ─────────────────────────────────────────────────
  // A single persistent connection per conversation. The hook handles
  // reconnection and the tool-relay protocol internally.

  // Accumulator for the current streaming turn (lives outside state for speed)
  const fullContentRef         = useRef("");
  const screenshotUrlsRef      = useRef<string[]>([]);
  const optimisticAssistantIdRef = useRef<string>("");
  const activeConversationIdRef  = useRef<string>("");

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
  }, []);

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
      pendingToolCallsRef.current = [];
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
      if (!pendingToolCallsRef.current.includes(tool)) {
        pendingToolCallsRef.current = [...pendingToolCallsRef.current, tool];
      }

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
      const { toolResultItems } = await executeLocalTools(toolCalls, {
        setActiveToolCalls,
        setSessionTasks,
        waitForAnswer:   waitForQuestionAnswer,
        evaluatePermission,
        requestApproval: () => new Promise<ToolApprovalDecision>((resolve) => { pendingApprovalResolveRef.current = resolve; }),
        requestGlobalAccess,
        recordGrant:     (tool, scope) => recordToolGrant(tool, scope, projectContext?.path ?? null, conversation?.id ?? null),
        workspaceRoot:   projectContext?.path ?? null,
        screenshotUrls:   screenshotUrlsRef.current,
        convId:           conversation?.id,
      });
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
  }, [activeToolCalls]);

  // ── Conversation display helpers ────────────────────────────────────────
  // Defined BEFORE handleStreamDone so the closure captures it correctly.
  const appendToDisplayedMessages = useCallback((message: ChatMessage) => {
    setDisplayedMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === message.id);
      if (idx >= 0) {
        const next = [...prev];
        next[idx] = message;
        return next;
      }
      return [...prev, message];
    });
  }, []);

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
  }, []);

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
        const { toolResultItems } = await executeLocalTools(toolCalls, {
          setActiveToolCalls,
          setSessionTasks,
          waitForAnswer:   waitForQuestionAnswer,
          evaluatePermission,
          requestApproval: () => new Promise<ToolApprovalDecision>((resolve) => { pendingApprovalResolveRef.current = resolve; }),
          requestGlobalAccess,
          recordGrant:     (tool, scope) => recordToolGrant(tool, scope, projectContext?.path ?? null, conversation?.id ?? null),
          workspaceRoot:   projectContext?.path ?? null,
          screenshotUrls:   screenshotUrlsRef.current,
          convId:           conversation?.id,
        });

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

      setIsStreaming(false);
      setStreamingContent("");
      latestStreamingContentRef.current = "";
      setStreamingMessageId(null);
      setActiveToolCalls([]);
      screenshotUrlsRef.current = [];
      harnessSegmentsRef.current = [];
      pendingSegmentTextRef.current = "";
      setHarnessSegments([]);
      thinkingContentRef.current = "";
      setThinkingContent("");
      return;
    }

    await addMessage(convId, assistantMsg);
    const finalConv = await loadConversation(convId);
    if (finalConv) {
      setConversation(finalConv);
      const last = finalConv.messages[finalConv.messages.length - 1];
      if (last?.role === "assistant") {
        appendToDisplayedMessages(last);
        if (pendingToolCallsRef.current.length > 0) {
          const tools = [...pendingToolCallsRef.current];
          setMessageToolCalls((prev) => new Map(prev).set(last.id, tools));
          pendingToolCallsRef.current = [];
        }
      }
      // Background memory processing
      if (isMemoryEnabled) {
        memorySystem.processConversation(finalConv).catch(() => {});
      }
    }

    // Reset streaming state
    setIsStreaming(false);
    setStreamingContent("");
    latestStreamingContentRef.current = "";
    setStreamingMessageId(null);
    setActiveToolCalls([]);
    screenshotUrlsRef.current = [];
    harnessSegmentsRef.current = [];
    pendingSegmentTextRef.current = "";
    setHarnessSegments([]);
    // Clear live thinking — it has already been captured onto the saved message
    // (message.thinkingContent). Leaving the live state set made the "thinking"
    // indicator linger after the turn was done.
    thinkingContentRef.current = "";
    setThinkingContent("");
  }, [flushStreamingContentUpdate, isMemoryEnabled, appendToDisplayedMessages, conversationStorageScope]); // eslint-disable-line

  useEffect(() => {
    handleStreamDoneRef.current = handleStreamDone;
  }, [handleStreamDone]);

  // ── Conversation helpers ────────────────────────────────────────────────
  const loadInitialMessages = useCallback(async (conversationId: string, totalCount: number) => {
    const msgs = await getConversationMessages(conversationId, MESSAGES_PER_PAGE, 0);
    setDisplayedMessages(msgs.reverse());
    setMessageOffset(MESSAGES_PER_PAGE);
    setHasMoreMessages(totalCount > MESSAGES_PER_PAGE);
  }, []);

  const loadMoreMessages = useCallback(async () => {
    if (!conversation || isLoadingMore || !hasMoreMessages) return;
    setIsLoadingMore(true);
    try {
      const more = await getConversationMessages(conversation.id, MESSAGES_PER_PAGE, messageOffset);
      if (more.length > 0) {
        setDisplayedMessages((prev) => [...more.reverse(), ...prev]);
        setMessageOffset((prev) => prev + more.length);
        setHasMoreMessages(more.length === MESSAGES_PER_PAGE);
      } else {
        setHasMoreMessages(false);
      }
    } finally {
      setIsLoadingMore(false);
    }
  }, [conversation, isLoadingMore, hasMoreMessages, messageOffset]);

  const getOrCreateConversation = useCallback(async (
    content: string,
    model:   string
  ): Promise<ChatConversation> => {
    if (conversation) return conversation;
    if (conversationCreationRef.current) return conversationCreationRef.current;
    const pendingProject = conversationStorageScope === "local"
      ? projectContext ?? pendingProjectContextRef.current
      : null;
    const p = createConversation(content.trim(), model, {
      storageScope: conversationStorageScope,
      provider: conversationStorageScope === "local" ? chatEngine : "studio",
      ...(pendingProject ? { project: pendingProject } : {}),
    });
    conversationCreationRef.current = p;
    try {
      const c = await p;
      setConversation(c);
      if (pendingProject) saveConvProjectCtx(c.id, pendingProject);

      // Fire-and-forget: generate an AI title in the background
      const snippet = content.trim().slice(0, 800);
      chat(
        [
          { role: "system", content: "Generate a concise 3-5 word title for this conversation based on the user message. Reply with only the title — no quotes, no punctuation, no explanation." },
          { role: "user",   content: snippet },
        ],
        model,
        { max_tokens: 30, direct: true }
      ).then(async (result) => {
        if (!result.success || !result.data) return;
        const aiTitle = result.data.trim().replace(/^["'""'']+|["'""'']+$/g, "").slice(0, 80);
        if (!aiTitle) return;
        await updateConversationTitle(c.id, aiTitle);
        const updated = await loadConversation(c.id);
        if (updated) setConversation(updated);
        window.dispatchEvent(new CustomEvent("studio:title-updated", { detail: { id: c.id, title: aiTitle } }));
      }).catch(() => { /* keep truncated title on failure */ });

      return c;
    } finally {
      conversationCreationRef.current = null;
    }
  }, [conversation, conversationStorageScope, projectContext, chatEngine]);

  // ── Pre-stream setup (shared by sendMessage and streamAndSaveResponse) ──
  const resetStreamingState = useCallback((optimisticAssistantId: string, existingContent = "") => {
    fullContentRef.current         = existingContent;
    screenshotUrlsRef.current      = [];
    thinkingContentRef.current     = "";
    pendingToolCallsRef.current    = [];
    agentIdToCallId.current.clear();
    harnessSegmentsRef.current     = [];
    pendingSegmentTextRef.current  = existingContent; // seed pending text for continue/regen
    setIsStreaming(true);
    setStreamingContent(existingContent);
    latestStreamingContentRef.current = existingContent;
    setStreamingMessageId(optimisticAssistantId);
    setActiveToolCalls([]);
    setAutoRoutedModel(null);
    setThinkingContent("");
    setHarnessSegments([]);
  }, []);

  const mapClaudeToolName = useCallback((tool: string) => {
    const lowered = tool.toLowerCase();
    if (lowered === "bash") return "bash";
    if (lowered === "powershell") return "powershell";
    if (lowered === "read") return "read_file";
    if (lowered === "edit") return "edit_file";
    if (lowered === "write") return "write_file";
    if (lowered === "glob") return "glob";
    if (lowered === "grep") return "grep";
    return lowered;
  }, []);

  const runClaudeTurn = useCallback(async (
    activeConversation: ChatConversation,
    prompt: string,
    optimisticAssistantId: string
  ) => {
    const bridgeSessionId = `claude-turn-${Date.now()}`;
    const permissionMode: PermissionModeId = settings.autopilotMode
      ? "bypassPermissions"
      : claudePermissionMode;
    const cwd = projectContext?.path || claudeSession?.cwd || undefined;
    const resume = claudeSession?.sessionId || undefined;
    const seenTextDeltas = { current: false };
    let finalExitCode = 0;

    activeConversationIdRef.current = activeConversation.id;
    optimisticAssistantIdRef.current = optimisticAssistantId;
    resetStreamingState(optimisticAssistantId);

    const completeClaudeTool = (toolUseId: string, rawResult: unknown) => {
      setActiveToolCalls((prev) =>
        prev.map((tc) =>
          tc.callId === toolUseId
            ? { ...tc, status: "complete", result: rawResult }
            : tc
        )
      );
    };

    try {
      await claudeBridgeService.runTurn({
        sessionId: bridgeSessionId,
        prompt,
        cwd,
        resume,
        model: resume ? undefined : claudeModel,
        permissionMode,
        thinkingBudget: effortToThinkingBudget(claudeEffortLevel),
        onLine: async (line, stream) => {
          if (stream === "stderr") {
            logger.warn("ClaudeBridge", "stderr", line);
            return;
          }

          let event: any;
          try {
            event = JSON.parse(line);
          } catch {
            logger.warn("ClaudeBridge", "Failed to parse Claude stream line", line);
            return;
          }

          if (event.type === "stream_event") {
            const delta = event.event?.delta;
            if (delta?.type === "text_delta" && typeof delta.text === "string") {
              seenTextDeltas.current = true;
              fullContentRef.current += delta.text;
              pendingSegmentTextRef.current += delta.text;
              scheduleStreamingContentUpdate(pendingSegmentTextRef.current);
            }
            return;
          }

          if (event.type === "system" && event.subtype === "init") {
            const nextClaude: ClaudeSessionMetadata = {
              ...(claudeSession ?? {}),
              sessionId: event.session_id,
              model: event.model ?? claudeModel,
              permissionMode: event.permissionMode ?? permissionMode,
              effortLevel: claudeEffortLevel,
              cwd: event.cwd ?? cwd,
              lastTurnAt: Date.now(),
            };
            setClaudeSession(nextClaude);
            setClaudeModelState(nextClaude.model ?? claudeModel);
            await persistConversationMetadata(activeConversation, "claude", nextClaude);
            return;
          }

          if (event.type === "rate_limit_event") {
            setClaudeSession((prev) => {
              const next = {
                ...(prev ?? {}),
                rateLimit: event.rate_limit_info,
                lastTurnAt: Date.now(),
              };
              persistConversationMetadata(activeConversation, "claude", next).catch(() => {});
              return next;
            });
            return;
          }

          if (event.type === "system" && event.subtype === "thinking_tokens") {
            // Token-count pings carry no real reasoning text. Showing a fake
            // "Thinking… N" placeholder is misleading and lingered after the
            // turn finished. We only surface genuine `thinking` content blocks
            // (handled below), so ignore this signal entirely.
            return;
          }

          if (event.type === "assistant" && Array.isArray(event.message?.content)) {
            const block = event.message.content[0];
            if (block?.type === "thinking" && typeof block.thinking === "string") {
              thinkingContentRef.current = block.thinking;
              setThinkingContent(block.thinking);
              return;
            }

            if (block?.type === "tool_use") {
              const toolName = mapClaudeToolName(block.name ?? "tool");
              const args = (block.input ?? {}) as Record<string, unknown>;
              const displayClass = classifyToolDisplay(toolName);
              setActiveToolCalls((prev) => [
                ...prev.filter((item) => item.callId !== block.id),
                {
                  callId: block.id,
                  tool: toolName,
                  args,
                  status: "running",
                  displayClass,
                },
              ]);

              if (displayClass === "stream") {
                const pendingText = pendingSegmentTextRef.current;
                if (pendingText) {
                  harnessSegmentsRef.current = [
                    ...harnessSegmentsRef.current,
                    { type: "text", content: pendingText },
                  ];
                  pendingSegmentTextRef.current = "";
                  setStreamingContent("");
                  latestStreamingContentRef.current = "";
                }
                harnessSegmentsRef.current = [
                  ...harnessSegmentsRef.current,
                  { type: "harness_event", event: buildHarnessEvent(block.id, toolName, args, "running") },
                ];
                setHarnessSegments([...harnessSegmentsRef.current]);
              }
              return;
            }

            if (!seenTextDeltas.current) {
              const textBlock = event.message.content.find((item: any) => item.type === "text");
              if (typeof textBlock?.text === "string" && textBlock.text) {
                fullContentRef.current = textBlock.text;
                pendingSegmentTextRef.current = textBlock.text;
                scheduleStreamingContentUpdate(textBlock.text);
              }
            }
            return;
          }

          if (event.type === "user" && Array.isArray(event.message?.content)) {
            const block = event.message.content[0];
            if (block?.type === "tool_result" && block.tool_use_id) {
              completeClaudeTool(block.tool_use_id, event.tool_use_result ?? block.content);
              harnessSegmentsRef.current = harnessSegmentsRef.current.map((segment) => {
                if (segment.type !== "harness_event" || segment.event.callId !== block.tool_use_id) return segment;
                return {
                  type: "harness_event" as const,
                  event: buildHarnessEvent(
                    block.tool_use_id,
                    segment.event.tool,
                    segment.event.args,
                    "complete",
                    event.tool_use_result ?? block.content
                  ),
                };
              });
              setHarnessSegments([...harnessSegmentsRef.current]);
            }
            return;
          }

          if (event.type === "result") {
            const turnCost = typeof event.total_cost_usd === "number" ? event.total_cost_usd : undefined;
            // Real usage from the model's own accounting — the ground truth that
            // includes the system prompt, skills, tools, and every file-read
            // result the estimate can't see.
            const usage = (event.usage ?? {}) as Record<string, unknown>;
            const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
            const nextClaude: ClaudeSessionMetadata = {
              ...(claudeSession ?? {}),
              sessionId: event.session_id ?? claudeSession?.sessionId,
              model: claudeModel,
              permissionMode,
              cwd,
              lastCostUsd: turnCost ?? claudeSession?.lastCostUsd,
              lastDurationMs: typeof event.duration_ms === "number" ? event.duration_ms : claudeSession?.lastDurationMs,
              lastInputTokens: num(usage.input_tokens) ?? claudeSession?.lastInputTokens,
              lastOutputTokens: num(usage.output_tokens) ?? claudeSession?.lastOutputTokens,
              lastCacheReadTokens: num(usage.cache_read_input_tokens) ?? claudeSession?.lastCacheReadTokens,
              lastCacheCreationTokens: num(usage.cache_creation_input_tokens) ?? claudeSession?.lastCacheCreationTokens,
              // Cumulative per-conversation spend — what the composer shows.
              totalCostUsd: (claudeSession?.totalCostUsd ?? 0) + (turnCost ?? 0),
              lastTurnAt: Date.now(),
              rateLimit: claudeSession?.rateLimit,
            };
            setClaudeSession(nextClaude);
            await persistConversationMetadata(activeConversation, "claude", nextClaude);
          }
        },
        onExit: (code) => {
          finalExitCode = code;
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setError(message);
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingContent("");
      latestStreamingContentRef.current = "";
      setStreamingMessageId(null);
      setActiveToolCalls([]);
      thinkingContentRef.current = "";
      setThinkingContent("");
      return;
    }

    if (finalExitCode !== 0 && !fullContentRef.current.trim()) {
      setError("Claude stopped before returning a response.");
      thinkingContentRef.current = "";
      setThinkingContent("");
      setIsLoading(false);
      setIsStreaming(false);
      setStreamingContent("");
      latestStreamingContentRef.current = "";
      setStreamingMessageId(null);
      setActiveToolCalls([]);
      return;
    }

    await handleStreamDoneRef.current?.();
    // Claude turns own their own loading lifecycle (no agentChat onLoadingChange
    // callback). Without this, isLoading stayed true after a successful turn and
    // the "Thinking…" dot bubble reappeared once streaming flags cleared.
    setIsLoading(false);
  }, [
    claudeSession,
    claudePermissionMode,
    claudeEffortLevel,
    claudeModel,
    mapClaudeToolName,
    persistConversationMetadata,
    projectContext,
    resetStreamingState,
    scheduleStreamingContentUpdate,
    settings.autopilotMode,
  ]);

  // ── sendMessage ─────────────────────────────────────────────────────────
  const sendMessage = useCallback(async (
    content:       string,
    useStreaming:   boolean = true,
    attachments:   FileAttachment[] = []
  ) => {
    const hasPDFImages  = attachments.some((a) => a.isPDF && a.pdfPageImages?.length);
    const hasImages     = attachments.some((a) => a.isImage || a.type.startsWith("image/")) || hasPDFImages;
    const hasDocuments  = attachments.some((a) => !a.isImage);
    if ((!content.trim() && !hasImages && !hasDocuments) || isLoading) return;

    // Queue the message if the AI is currently streaming — it auto-sends when done
    if (isStreaming) {
      setPendingMessages((prev) => [...prev, { content, attachments }]);
      return;
    }

    const userDisplayContent = content.trim();
    const silentPrompt    = !userDisplayContent && hasImages;
    const silentDocPrompt = !userDisplayContent && hasDocuments && !hasImages;
    const apiContent      = userDisplayContent
      || (hasImages ? "Describe this image in detail." : "Please analyze this document.");

    setError(null);
    setIsLoading(true);

    // ── Optimistic UI ────────────────────────────────────────────────────
    const imageUrls = hasImages
      ? attachments.filter((a) => a.isImage && a.file).map((a) => URL.createObjectURL(a.file!))
      : [];
    const docAttachments = attachments
      .filter((a) => !a.isImage)
      .map((a) => ({ name: a.name, extension: a.extension }));

    const optimisticId = `optimistic-${Date.now()}`;
    const optimisticAsst = `ai-optimistic-${Date.now()}`;
    appendToDisplayedMessages({
      id: optimisticId, role: "user", content: userDisplayContent,
      timestamp: Date.now(),
      ...(imageUrls.length > 0 ? { imageUrls } : {}),
      ...(docAttachments.length > 0 ? { documentAttachments: docAttachments } : {}),
    });
    appendToDisplayedMessages({ id: optimisticAsst, role: "assistant", content: "", timestamp: Date.now() + 1 });
    setStreamingMessageId(optimisticAsst);

    if (hasImages && !currentModelSupportsVision) {
      setError("Selected model doesn't support images. Please choose a vision model.");
      setIsLoading(false);
      setDisplayedMessages((prev) => prev.filter((m) => m.id !== optimisticId && m.id !== optimisticAsst));
      setStreamingMessageId(null);
      return;
    }

    // ── Create/get conversation ──────────────────────────────────────────
    let activeConversation: ChatConversation;
    try {
      activeConversation = await getOrCreateConversation(
        userDisplayContent || (hasImages ? "Image" : attachments[0]?.name || "Document"),
        chatEngine === "claude" ? claudeModel : currentModel
      );
    } catch (err) {
      const nf = handleNetworkFailure(err);
      setError(nf.userMessage);
      setIsLoading(false);
      setDisplayedMessages((prev) => prev.filter((m) => m.id !== optimisticId && m.id !== optimisticAsst));
      setStreamingMessageId(null);
      return;
    }

    // ── Save user message ────────────────────────────────────────────────
    const activeIsClaudeOwned = isClaudeOwnedConversation(activeConversation);
    if (activeIsClaudeOwned && chatEngine !== "claude") {
      setError("This is a Claude Code native conversation. Continue with Claude, or fork it into Studio first.");
      setIsLoading(false);
      setDisplayedMessages((prev) => prev.filter((m) => m.id !== optimisticId && m.id !== optimisticAsst));
      setStreamingMessageId(null);
      return;
    }

    if (!activeIsClaudeOwned) try {
      await addMessage(activeConversation.id, {
        id: optimisticId, timestamp: Date.now(), role: "user" as const, content: userDisplayContent,
        ...(imageUrls.length > 0 ? { imageUrls } : {}),
        ...(docAttachments.length > 0 ? { documentAttachments: docAttachments } : {}),
      });
      const updated = await loadConversation(activeConversation.id);
      if (updated) {
        setConversation(updated);
        const last = updated.messages[updated.messages.length - 1];
        if (last) setDisplayedMessages((prev) => prev.map((m) => m.id === optimisticId ? last : m));
      }
    } catch (err) {
      const nf = handleNetworkFailure(err);
      setError(`Failed to save message: ${nf.userMessage}`);
      setIsLoading(false);
      setDisplayedMessages((prev) => prev.filter((m) => m.id !== optimisticId && m.id !== optimisticAsst));
      setStreamingMessageId(null);
      return;
    }

    if (chatEngine === "claude") {
      const savedConversation = await loadConversation(activeConversation.id);
      const latestConversation = savedConversation ?? activeConversation;
      const prompt = apiContent;

      await persistConversationMetadata(
        latestConversation,
        "claude",
        {
          ...(claudeSession ?? {}),
          model: claudeModel,
          permissionMode: settings.autopilotMode ? "bypassPermissions" : claudePermissionMode,
          effortLevel: claudeEffortLevel,
          cwd: projectContext?.path,
          lastTurnAt: Date.now(),
        }
      );

      await runClaudeTurn(latestConversation, prompt, optimisticAsst);
      return;
    }

    const {
      prunedMessages: initialPruned,
      runningMcpServers,
      freshConv,
    } = await buildSendContext({
      convId:         activeConversation.id,
      userContent:    content,
      attachments,
      model:          currentModel,
      isMemoryEnabled,
      projectContext,
      storageScope: conversationStorageScope,
      imageModel:     settings.imageModel,
      videoModel:     settings.videoModel,
      silentPrompt,
      silentDocPrompt,
      apiContent,
      getContextLimit,
      setContextTokens,
      setContextLimit,
    });
    let prunedMessages = initialPruned;

    // Image augmentation
    if (hasImages && currentModelSupportsVision && !currentModel.startsWith("local:")) {
      prunedMessages = await aiService.augmentMessagesWithImages(prunedMessages, attachments);
    }
    if (hasPDFImages && currentModelSupportsVision && !currentModel.startsWith("local:")) {
      prunedMessages = await aiService.augmentMessagesWithPDFImages(prunedMessages, attachments);
    }

    // Local Ollama vision — non-streaming path
    if (hasImages && currentModelSupportsVision && currentModel.startsWith("local:")) {
      const resp = await aiService.chatWithImages(prunedMessages, currentModel, attachments);
      if (resp.success && resp.data) {
        const parsed = parseChatResponse(extractMessageText(resp.data.choices[0]?.message?.content));
        if (!isValidChatResponse(parsed)) { setError("AI response invalid."); return; }
        await addMessage(activeConversation.id, { id: optimisticAsst, timestamp: Date.now(), role: "assistant" as const, content: parsed });
        const fc = await loadConversation(activeConversation.id);
        if (fc) {
          setConversation(fc);
          const last = fc.messages[fc.messages.length - 1];
          if (last?.role === "assistant") appendToDisplayedMessages(last);
        }
        setIsLoading(false);
        setStreamingMessageId(null);
        if (isMemoryEnabled) memorySystem.processConversation(activeConversation).catch(() => {});
      } else {
        setError(errorService.getUserMessage(resp.error));
      }
      return;
    }

    // Background compaction
    if (freshConv) maybeCompact(freshConv, currentModel, getContextLimit, isSummarizingRef, setIsSummarizing, setConversation).catch(() => {});

    // ── Stream via WebSocket ─────────────────────────────────────────────
    if (useStreaming) {
      activeConversationIdRef.current    = activeConversation.id;
      optimisticAssistantIdRef.current   = optimisticAsst;
      resetStreamingState(optimisticAsst);

      const userId = await tokenManager.getUserId();
      const body = buildChatBody({
        messages: prunedMessages,
        model: currentModel,
        runningMcpServers,
        storageScope: conversationStorageScope,
        reasoningBudget,
        userId: userId ?? undefined,
      });

      try {
        // Pass activeConversation.id explicitly — the agentChat closure captured
        // in this callback may still hold conversationId = null (the value from
        // before React re-rendered after getOrCreateConversation). The explicit ID
        // bypasses the stale closure so the socket is set up for the right DO instance.
        agentChat.startTurn(body, activeConversation.id);
      } catch (err: any) {
        if (err?.name === "AbortError") return;
        setError(errorService.getUserMessage(err));
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // ── Non-streaming (rare) ─────────────────────────────────────────────
    abortControllerRef.current = new AbortController();
    const resp = await aiService.chat(prunedMessages, currentModel, {
      localEngineConnected: runningMcpServers.includes("studio-harness"),
      signal: abortControllerRef.current.signal,
    });

    if (resp.success && resp.data) {
      const parsed = parseChatResponse(resp.data);
      if (!isValidChatResponse(parsed)) { setError("AI response invalid."); setIsLoading(false); return; }
      const asst: any = { id: optimisticAsst, timestamp: Date.now(), role: "assistant", content: parsed };
      await addMessage(activeConversation.id, asst);
      const fc = await loadConversation(activeConversation.id);
      if (fc) {
        setConversation(fc);
        const last = fc.messages[fc.messages.length - 1];
        if (last?.role === "assistant") appendToDisplayedMessages(last);
      }
    } else {
      setError(errorService.getUserMessage(resp.error));
    }
    setIsLoading(false);
    setStreamingMessageId(null);
  }, [
    claudeSession, claudeModel, currentModel, isLoading, isStreaming, currentModelSupportsVision,
    isMemoryEnabled, getContextLimit, appendToDisplayedMessages, resetStreamingState,
    persistConversationMetadata, projectContext, chatEngine, runClaudeTurn, settings, reasoningBudget, agentChat, getOrCreateConversation,
    claudePermissionMode, claudeEffortLevel, conversationStorageScope,
  ]);

  // Keep ref in sync so the pending-queue drain effect can call sendMessage without
  // capturing a stale closure.
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]);

  const cancelPendingMessage = useCallback((index: number) => {
    setPendingMessages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ── streamAndSaveResponse (regenerate / continue) ───────────────────────
  const streamAndSaveResponse = useCallback(async (
    conversationId:      string,
    messagesToSend:      APIChatMessage[],
    appendToMessageId?:  string,
    overwriteMessageId?: string
  ) => {
    let existingContent = "";
    if (appendToMessageId) {
      const c = await loadConversation(conversationId);
      existingContent = c?.messages.find((m) => m.id === appendToMessageId)?.content ?? "";
    }

    // overwriteMessageId: the message whose content is replaced in-place (regenerate)
    // appendToMessageId:  the message to append new content to (continue)
    const optId = overwriteMessageId ?? appendToMessageId ?? `ai-regen-${Date.now()}`;
    activeConversationIdRef.current  = conversationId;
    optimisticAssistantIdRef.current = optId;
    resetStreamingState(optId, existingContent ? existingContent + "\n\n" : "");
    abortControllerRef.current = new AbortController();

    const runningMcpServers = await getMcpServers(conversationStorageScope);
    const body = buildChatBody({
      messages: messagesToSend,
      model: currentModel,
      runningMcpServers,
      storageScope: conversationStorageScope,
      reasoningBudget,
    });

    try {
      agentChat.startTurn(body);
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(errorService.getUserMessage(err));
    }
  }, [currentModel, reasoningBudget, agentChat, resetStreamingState, conversationStorageScope]);

  // ── regenerateResponse ──────────────────────────────────────────────────
  const regenerateResponse = useCallback(async () => {
    if (!conversation || isLoading) return;
    if (chatEngine === "claude") {
      setError("Regenerate is not wired for Cloud mode yet. Send a quick follow-up instead.");
      return;
    }
    const lastAsst = [...conversation.messages].reverse().find((m) => m.role === "assistant");
    if (!lastAsst) return;

    setIsLoading(true);
    setError(null);
    setDisplayedMessages((prev) => prev.map((m) => m.id === lastAsst.id ? { ...m, content: "" } : m));

    try {
      const running = await getMcpServers(conversationStorageScope);

      const fresh = await loadConversation(conversation.id);
      let base: APIChatMessage[] = fresh
        ? await buildApiMessages(fresh, currentModel, getContextLimit, setContextTokens, setContextLimit)
        : (await getContextMessages(conversation.id, MAX_CONTEXT_MESSAGES)).map((m) => ({ role: m.role, content: m.content }));

      base = base.slice(0, -1); // Remove last assistant message
      const enhanced = applyAllSystemMessages(base, running, settings.imageModel, settings.videoModel, projectContext);
      const pruned   = pruneContextByTokens(enhanced, getContextLimit(currentModel));

      await streamAndSaveResponse(conversation.id, pruned, undefined, lastAsst.id);
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(errorService.getUserMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [conversation, currentModel, isLoading, getContextLimit, settings, projectContext, chatEngine, streamAndSaveResponse, conversationStorageScope]);

  // ── continueResponse ────────────────────────────────────────────────────
  const continueResponse = useCallback(async () => {
    if (!conversation || isLoading) return;
    const lastAsst = [...conversation.messages].reverse().find((m) => m.role === "assistant");
    if (!lastAsst) return;

    setIsLoading(true);
    setError(null);

    if (chatEngine === "claude") {
      const optimisticId = `ai-continue-${Date.now()}`;
      appendToDisplayedMessages({
        id: optimisticId,
        role: "assistant",
        content: "",
        timestamp: Date.now(),
      });
      try {
        await runClaudeTurn(
          conversation,
          "Please continue your previous response from exactly where you left off. Do not repeat anything already written.",
          optimisticId
        );
      } finally {
        setIsLoading(false);
      }
      return;
    }

    try {
      const running = await getMcpServers(conversationStorageScope);

      const fresh = await loadConversation(conversation.id);
      const base: APIChatMessage[] = fresh
        ? await buildApiMessages(fresh, currentModel, getContextLimit, setContextTokens, setContextLimit)
        : (await getContextMessages(conversation.id, MAX_CONTEXT_MESSAGES)).map((m) => ({ role: m.role, content: m.content }));

      base.push({
        role: "user",
        content: "Please continue your previous response from exactly where you left off. Do not repeat anything already written. Do not add any preamble or acknowledgement — simply continue the text.",
      });

      const enhanced = applyAllSystemMessages(base, running, settings.imageModel, settings.videoModel, projectContext);
      const pruned   = pruneContextByTokens(enhanced, getContextLimit(currentModel));

      await streamAndSaveResponse(conversation.id, pruned, lastAsst.id);
    } catch (err: any) {
      if (err?.name !== "AbortError") setError(errorService.getUserMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [appendToDisplayedMessages, conversation, currentModel, getContextLimit, isLoading, projectContext, chatEngine, runClaudeTurn, settings, streamAndSaveResponse, conversationStorageScope]);

  // ── Voice input ─────────────────────────────────────────────────────────
  // Mirror sendMessage into a ref so the stable onTranscribed callback below
  // always calls the latest version without listing it as a dependency.
  sendMessageForVoiceRef.current = sendMessage;

  const onTranscribedForVoice = useCallback(async (text: string) => {
    await sendMessageForVoiceRef.current?.(text, false);
  }, []); // intentionally empty — reads from ref at call time

  const { isRecordingVoice, sendVoiceMessage: _sendVoiceMessage, sendTranscribedText } = useVoiceInput({
    transcriptionModel: settings.transcriptionModel,
    onTranscribed: onTranscribedForVoice,
    onError: setError,
    onLoadingChange: setIsLoading,
  });

  const sendVoiceMessage = useCallback(async () => {
    if (!conversation) return;
    await _sendVoiceMessage();
  }, [conversation, _sendVoiceMessage]);

  // ── Conversation CRUD ───────────────────────────────────────────────────

  const createNewConversation = useCallback(async (
    scope?: ConversationStorageScope,
    options: { preserveProject?: boolean } = {}
  ) => {
    // A new conversation resets "allow for this chat" per-tool grants.
    clearSessionGrants();
    const nextScope = scope ?? conversationStorageScope;
    const preservedProject = options.preserveProject && nextScope === "local" ? projectContext : null;
    const nextEngine = nextScope === "cloud" ? "studio" : getPreferredChatEngine() ?? "studio";
    setConversationStorageScopeState(nextScope);
    // wsPool keeps the background socket alive automatically.
    // Register the title so notifications can name the conversation.
    if (activeConversationIdRef.current && conversation?.title) {
      backgroundSessionTracker.setTitle(activeConversationIdRef.current, conversation.title);
    }

    // Drain: if a stream is active, save whatever content has arrived so far.
    // wsPool continues streaming in the background; this saves the partial so
    // the user sees something if they return before the response finishes.
    if (isStreaming && fullContentRef.current.trim() && activeConversationIdRef.current) {
      const convId  = activeConversationIdRef.current;
      const content = fullContentRef.current.trim();
      const msgId   = optimisticAssistantIdRef.current || `ai-partial-${Date.now()}`;
      try {
        await addMessage(convId, {
          id: msgId, timestamp: Date.now(), role: "assistant" as const, content,
        });
      } catch { /* non-critical — don't block navigation */ }
    }

    setPendingMessages([]);
    setConversation(null);
    setDisplayedMessages([]);
    setHasMoreMessages(false);
    setMessageOffset(0);
    setError(null);
    setMessageToolCalls(new Map());
    resetPermittedTools();
    setCurrentModel(settings.defaultChatModel || "auto");
    setChatEngineState(nextEngine);
    conversationCreationRef.current = null;
    setContextTokens(0);
    setContextLimit(
      getContextLimit(nextEngine === "claude" ? claudeModel : (settings.defaultChatModel || "auto"))
    );
    setSessionTasks([]);
    // New chat → no project folder
    setProjectContextState(preservedProject);
    pendingProjectContextRef.current = preservedProject;
  }, [conversationStorageScope, isStreaming, conversation, settings.defaultChatModel, getContextLimit, resetPermittedTools, projectContext, claudeModel]);

  const loadConversationById = useCallback(async (id: string) => {
    // wsPool keeps the background socket alive automatically.
    // Register the title so notifications can name the outgoing conversation.
    if (activeConversationIdRef.current && activeConversationIdRef.current !== id && conversation?.title) {
      backgroundSessionTracker.setTitle(activeConversationIdRef.current, conversation.title);
    }

    // Returning to a conversation — mark it as acknowledged (removes done_unread badge)
    backgroundSessionTracker.acknowledge(id);
    setPendingMessages([]);

    const conv = await loadConversation(id);
    if (!conv) return;
    const nextScope = conv.metadata?.storageScope ?? "cloud";
    // Clear any pending context before the conversation state settles so
    // the pendingProjectContextRef effect doesn't accidentally re-save it.
    pendingProjectContextRef.current = null;
    setConversationStorageScopeState(nextScope);
    const claudeCwd = conv.metadata?.claude?.cwd;
    const claudeProjectContext = claudeCwd
      ? {
          path: claudeCwd,
          name: claudeCwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? claudeCwd,
        }
      : null;
    const nextProjectContext = nextScope === "local"
      ? conv.metadata?.project ?? getConvProjectCtx(id) ?? claudeProjectContext
      : null;
    setProjectContextState(nextProjectContext);
    setConversation(conv);
    const rawProvider = conv.metadata?.provider ?? "studio";
    const nextProvider: ChatEngine = rawProvider === "cloud" ? "claude" : (rawProvider as ChatEngine);
    const preferredProvider = getPreferredChatEngine(conv.id) ?? nextProvider;
    setChatEngineState(nextScope === "cloud" ? "studio" : normalizeEngineForConversationOwner(conv.metadata, preferredProvider));
    setCurrentModel(conv.model);
    setError(null);
    setMessageToolCalls(new Map());
    await loadInitialMessages(id, conv.messages.length);
    const limit = getContextLimit(conv.model);
    setContextLimit(limit);
    if (conv.messages.length > 0) {
      const raw = conv.contextSummary !== undefined && conv.summarizedUpToIndex !== undefined
        ? conv.messages.slice(conv.summarizedUpToIndex + 1).slice(-50)
        : conv.messages.slice(-50);
      const objs = raw.map((m) => ({ content: m.content }));
      if (conv.contextSummary) objs.unshift({ content: conv.contextSummary });
      import("@/utils/tokenEstimator").then(({ countMessageTokensAsync: c }) =>
        c(objs).then(setContextTokens).catch(() => {})
      );
    } else {
      setContextTokens(0);
    }
    maybeCompact(conv, conv.model, getContextLimit, isSummarizingRef, setIsSummarizing, setConversation).catch(() => {});

    // Catch-up: if the last stored message is from the user, the assistant
    // response may have been generated server-side while the client was away.
    // The DO keeps the completed text for exactly this reconnect window.
    const lastMsg = conv.messages[conv.messages.length - 1];
    if (lastMsg?.role === "user") {
      fetchPendingCompletion(id).then(async (content) => {
        if (!content) return;
        await applyCatchUp(id, content, setConversation, appendToDisplayedMessages);
        clearPendingCompletion(id).catch(() => {});
      }).catch(() => {});
    }
  }, [conversation, getContextLimit, loadInitialMessages, appendToDisplayedMessages]);

  const updateTitle = useCallback(async (title: string) => {
    if (!conversation) return;
    await updateConversationTitle(conversation.id, title);
    const updated = await loadConversation(conversation.id);
    if (updated) setConversation(updated);
  }, [conversation]);

  const forkConversationToStudio = useCallback(async () => {
    if (!conversation) return;
    const forked = await forkConversationToStudioStorage(conversation.id);
    if (!forked) return;
    await loadConversationById(forked.id);
    window.dispatchEvent(new CustomEvent("studio:title-updated", {
      detail: { id: forked.id, title: forked.title },
    }));
  }, [conversation, loadConversationById]);

  const editMessage = useCallback(async (messageId: string, newContent: string) => {
    if (!conversation) return;
    await updateMessage(conversation.id, messageId, newContent);
    const updated = await loadConversation(conversation.id);
    if (updated) {
      setConversation(updated);
      setDisplayedMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: newContent } : m));
    }
  }, [conversation]);

  const editMessageAndRegenerate = useCallback(async (messageId: string, newContent: string) => {
    if (!conversation || isLoading) return;

    const msg = conversation.messages.find((m) => m.id === messageId);
    if (!msg) return;

    await updateMessage(conversation.id, messageId, newContent);

    if (msg.role === "user") {
      await truncateMessagesAfter(conversation.id, messageId);

      const updated = await loadConversation(conversation.id);
      if (!updated) return;
      setConversation(updated);

      setDisplayedMessages((prev) => {
        const idx = prev.findIndex((m) => m.id === messageId);
        if (idx === -1) return prev;
        return [...prev.slice(0, idx), { ...prev[idx], content: newContent }];
      });

      const optimisticAsst = `ai-optimistic-${Date.now()}`;
      appendToDisplayedMessages({ id: optimisticAsst, role: "assistant", content: "", timestamp: Date.now() });

      setIsLoading(true);
      setError(null);

      const running = await getMcpServers(conversationStorageScope);

      const base = await buildApiMessages(updated, currentModel, getContextLimit, setContextTokens, setContextLimit);
      const enhanced = applyAllSystemMessages(base, running, settings.imageModel, settings.videoModel, projectContext);
      const pruned = pruneContextByTokens(enhanced, getContextLimit(currentModel));

      activeConversationIdRef.current = conversation.id;
      optimisticAssistantIdRef.current = optimisticAsst;
      resetStreamingState(optimisticAsst);

      const body = buildChatBody({
        messages: pruned,
        model: currentModel,
        runningMcpServers: running,
        storageScope: conversationStorageScope,
        reasoningBudget,
      });

      try {
        agentChat.startTurn(body, conversation.id);
      } catch (err: any) {
        if (err?.name !== "AbortError") setError(errorService.getUserMessage(err));
      } finally {
        setIsLoading(false);
      }
    } else {
      const updated = await loadConversation(conversation.id);
      if (updated) {
        setConversation(updated);
        setDisplayedMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, content: newContent } : m));
      }
    }
  }, [conversation, currentModel, isLoading, getContextLimit, settings, projectContext, appendToDisplayedMessages, agentChat, reasoningBudget, conversationStorageScope, resetStreamingState]);

  const deleteMessageById = useCallback(async (messageId: string) => {
    if (!conversation) return;
    const msg = conversation.messages.find((m) => m.id === messageId);
    if (msg?.content) deleteRemoteImages(extractGeneratedImageIds(msg.content), TAURI_CONFIG.API_BASE_URL);
    await deleteMessage(conversation.id, messageId);
    const updated = await loadConversation(conversation.id);
    if (updated) {
      setConversation(updated);
      setDisplayedMessages((prev) => prev.filter((m) => m.id !== messageId));
    }
  }, [conversation]);

  const setModel = useCallback((model: string) => {
    setCurrentModel(model);
    setContextLimit(getContextLimit(model));
    if (conversation) { conversation.model = model; saveConversation(conversation); }
  }, [conversation, getContextLimit]);

  const clearChat = useCallback(() => createNewConversation(), [createNewConversation]);

  const getMessageToolCalls = useCallback(
    (messageId: string) => messageToolCalls.get(messageId) ?? null,
    [messageToolCalls]
  );

  const abortGeneration = useCallback(() => {
    agentChat.abort();
    claudeBridgeService.stopActiveTurn().catch(() => {});
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsLoading(false);
    setIsStreaming(false);
    setStreamingContent("");
    latestStreamingContentRef.current = "";
    setStreamingMessageId(null);
    setActiveToolCalls([]);
  }, [agentChat]);

  const enableMemoryForConversation = useCallback(async (enabled: boolean) => {
    setIsMemoryEnabled(enabled);
    if (conversation) {
      await memorySystem.setConversationShared(conversation.id, enabled);
      if (enabled) await memorySystem.processConversation(conversation);
    }
  }, [conversation]);

  // ── Provider value ──────────────────────────────────────────────────────
  return (
    <ChatContext.Provider value={{
      conversation, isLoading, isStreaming, streamingContent, streamingMessageId,
      error, setError, clearError: () => setError(null),
      currentModel,
      conversationStorageScope,
      setConversationStorageScope,
      chatEngine, setChatEngine,
      claudeModel, setClaudeModel, claudeSession,
      claudePermissionMode,
      setClaudePermissionMode: setClaudePermissionModeState,
      claudeEffortLevel,
      setClaudeEffortLevel: setClaudeEffortLevelState,
      sendMessage, sendVoiceMessage, sendTranscribedText, isRecordingVoice,
      editMessage, editMessageAndRegenerate, deleteMessageById, regenerateResponse, continueResponse,
      clearChat, setModel, loadConversationById, createNewConversation, forkConversationToStudio, updateTitle,
      displayedMessages, appendToDisplayedMessages, hasMoreMessages, loadMoreMessages, isLoadingMore,
      getMessageToolCalls,
      activeToolCalls,
      permittedTools, grantToolPermission, revokeToolPermission,
      currentModelSupportsVision,
      autoRoutedModel,
      enableMemoryForConversation, isMemoryEnabled,
      isSummarizing, contextTokens, contextLimit, usageContextTokens,
      answerPendingQuestion,
      resolveToolApproval:    (d) => { pendingApprovalResolveRef.current?.(d); pendingApprovalResolveRef.current = null; },
      resolveGlobalAccess,
      pendingMessages, cancelPendingMessage,
      sessionTasks,
      abortGeneration,
      projectContext, setProjectContext,
      thinkingContent, reasoningBudget, setReasoningBudget,
      harnessSegments,
    }}>
      {children}
      <GlobalAccessModal
        open={globalAccessPrompt !== null}
        toolName={globalAccessPrompt?.toolName}
        onResolve={resolveGlobalAccess}
      />
    </ChatContext.Provider>
  );
}
