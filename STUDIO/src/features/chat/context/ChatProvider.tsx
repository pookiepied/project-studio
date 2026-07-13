/**
 * ChatProvider — the chat state coordinator.
 *
 * Owns the state and the turn-scoped refs, then composes the behavior from
 * focused modules. Nothing here should contain turn logic; if a block grows
 * past a few lines it belongs in one of these:
 *
 *   - Outbound turn (send/queue/regenerate/continue) → useSendPipeline.ts
 *   - Inbound stream (agent handlers, handleStreamDone,
 *     DSML interception)                             → useStreamHandlers.ts
 *   - Conversation CRUD (create/load/fork/edit/abort)→ useConversationActions.ts
 *   - Claude Code (CLI bridge) turn driver           → runClaudeTurn.ts
 *   - executeLocalTools callback bundle              → toolExecutionCallbacks.ts
 *   - Types / constants                              → types.ts, constants.ts
 *   - Message + context pipeline                     → messageBuilder.ts,
 *                                                      contextCompactor.ts
 *
 * The Local Runtime (WebSocket transport, local tool execution, tool cards) is
 * reached only through the `@/runtime` barrel.
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
import type { ChatConversation }                       from "@/types";
import type { AutoRoutedInfo } from "@/types/chat";
import { memorySystem }                                from "@/core/storage/memorySystem";
import { useSettings }                                 from "@/app/contexts/SettingsContext";
import { useModelsContext as useModels }                from "@/features/models/context";
import {
  createConversation, saveConversation, loadConversation, updateConversationTitle,
} from "@/features/chat/conversations/chatHistoryService";
import type { ConversationStorageScope } from "@/core/conversations";
import {
  canContinueWithEngine,
  isClaudeOwnedConversation,
  normalizeEngineForConversationOwner,
} from "@/features/chat/conversations/ownership/conversationOwnership";
import {
  getPreferredChatEngine,
  savePreferredChatEngine,
} from "@/features/chat/conversations/preferences/chatEnginePreference";

import { useVoiceInput }                               from "@/features/voice/hooks/useVoiceInput";
import { usePermittedTools }                           from "@/features/chat/hooks/usePermittedTools";

import type { MessageSegment } from "@/types";
import type { ChatContextType, ActiveToolCall, TaskItem } from "./types";
import { DEFAULT_MAX_CONTEXT_TOKENS } from "./constants";
import { chat } from "@/features/chat/services/chatService";
import type { ChatEngine, ClaudeEffortLevel } from "@/cliBridges/types";
import type { PermissionModeId, PermissionDecision, ActionMode } from "@/core/permissions";
import {
  evaluateToolCall,
  chatModeFromStorageScope,
  deriveLocalContext,
  getWorkspaceTrust,
  hasGlobalGrant,
  buildGrantLookupForConversation,
} from "@/core/permissions";
import { readLocalMcpPermission, getLocalMcpServer } from "@/runtime";
import { GlobalAccessModal } from "@/features/permissions/components/GlobalAccessModal";
import { ManagementAccessModal } from "@/features/permissions/components/ManagementAccessModal";
import type { ToolApprovalDecision } from "./types";
import { runClaudeTurn as runClaudeTurnDriver } from "./runClaudeTurn";
import { useStreamHandlers } from "./useStreamHandlers";
import { useSendPipeline } from "./useSendPipeline";
import { useConversationActions } from "./useConversationActions";
import { useAccessPrompts } from "./useAccessPrompts";
import { useStreamingLifecycle } from "./useStreamingLifecycle";
import { useConversationDisplay } from "./useConversationDisplay";
import { useConversationBootstrap } from "./useConversationBootstrap";

import {
  saveConvProjectCtx,
  type ProjectCtx,
} from "./projectContextStorage";
import { backgroundSessionTracker } from "@/features/chat/conversations/backgroundSessionTracker";
import { NotificationService } from "@/core/notifications";
import type { PendingMessage } from "./types";
import type { ClaudeSessionMetadata } from "@/types";
import { resolveContextLimit, supportsVisionForModel } from "./ChatProviderModelHelpers";

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
    return resolveContextLimit({ modelId, models, autoRoutedModel });
  }, [models, autoRoutedModel]);

  // ── Core state ─────────────────────────────────────────────────────────
  const [conversation,       setConversation]       = useState<ChatConversation | null>(null);
  const [isLoading,          setIsLoading]          = useState(false);
  const [isStreaming,        setIsStreaming]         = useState(false);

  // ── Pending message queue ───────────────────────────────────────────────
  const [pendingMessages, setPendingMessages] = useState<PendingMessage[]>([]);
  const sendMessageRef = useRef<((content: string, useStreaming?: boolean, attachments?: import("@/features/chat/attachments/fileAttachmentService").FileAttachment[]) => Promise<void>) | null>(null);
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
  const {
    displayedMessages,
    hasMoreMessages,
    isLoadingMore,
    appendToDisplayedMessages,
    loadInitialMessages,
    loadMoreMessages,
    setDisplayedMessages,
    setHasMoreMessages,
    setMessageOffset,
  } = useConversationDisplay({ conversation });

  // ── Tool / interaction state ────────────────────────────────────────────
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
  // Trust is recorded when a project folder is selected. Here we only *read* it,
  // below, to gate mutating tool calls via the permission engine.

  // Global machine-access and system-management prompts are resolved lazily
  // from tool execution, while the hook owns their modal state and grants.
  const {
    globalAccessPrompt,
    managementPrompt,
    resolveGlobalAccess,
    requestGlobalAccess,
    resolveManagementAccess,
    requestManagementAccess,
  } = useAccessPrompts(conversation?.id ?? null);

  // The effective mode is snapshotted at task start and held for the entire
  // task, including tool-loop continuations. A mid-run toggle lands on the next
  // task instead of changing enforcement partway through a response.
  //
  // liveActionModeRef mirrors the current desired mode; the freeze effect copies
  // it on the isStreaming rising edge and clears it when the assistant returns
  // to idle. Reading the live value via a ref avoids a stale closure while
  // keeping isStreaming as the only trigger.
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
  const currentModelSupportsVision = supportsVisionForModel(models, currentModel);

  // ── Permission helpers ──────────────────────────────────────────────────
  const { permittedTools, grantToolPermission, revokeToolPermission, resetPermittedTools } = usePermittedTools();

  // ── Load most recent conversation on mount ──────────────────────────────
  useConversationBootstrap({
    loadInitialMessages,
    appendToDisplayedMessages,
    getContextLimit,
    isSummarizingRef,
    setConversation,
    setCurrentModel,
    setIsSummarizing,
  });
  // ── WebSocket chat hook ─────────────────────────────────────────────────
  // A single persistent connection per conversation. The hook handles
  // reconnection and the tool-relay protocol internally.

  // Accumulator for the current streaming turn (lives outside state for speed)
  const fullContentRef         = useRef("");
  const screenshotUrlsRef      = useRef<string[]>([]);
  const optimisticAssistantIdRef = useRef<string>("");
  const activeConversationIdRef  = useRef<string>("");
  const {
    latestStreamingContentRef,
    thinkingContentRef,
    scheduleStreamingContentUpdate,
    flushStreamingContentUpdate,
    finishStreamingTurn,
    failStreamingTurn,
  } = useStreamingLifecycle({
    screenshotUrlsRef,
    harnessSegmentsRef,
    pendingSegmentTextRef,
    setError,
    setIsLoading,
    setIsStreaming,
    setStreamingContent,
    setStreamingMessageId,
    setActiveToolCalls,
    setHarnessSegments,
    setThinkingContent,
  });

  // Inbound stream handlers.
  const { agentChat, answerPendingQuestion } = useStreamHandlers({
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
    requestManagementAccess,
  });

  // ── Conversation helpers ────────────────────────────────────────────────
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

  const runClaudeTurn = useCallback(async (
    activeConversation: ChatConversation,
    prompt: string,
    optimisticAssistantId: string
  ) => {
    await runClaudeTurnDriver({
      activeConversation,
      prompt,
      optimisticAssistantId,
      autopilotMode: !!settings.autopilotMode,
      claudePermissionMode,
      claudeEffortLevel,
      claudeModel,
      claudeSession,
      projectContextPath: projectContext?.path ?? null,
      activeConversationIdRef,
      optimisticAssistantIdRef,
      fullContentRef,
      pendingSegmentTextRef,
      latestStreamingContentRef,
      thinkingContentRef,
      harnessSegmentsRef,
      handleStreamDoneRef,
      resetStreamingState,
      scheduleStreamingContentUpdate,
      setActiveToolCalls,
      setHarnessSegments,
      setStreamingContent,
      setThinkingContent,
      setClaudeSession,
      setClaudeModelState,
      setIsLoading,
      persistConversationMetadata,
      failStreamingTurn,
    });
  }, [
    claudeSession,
    claudePermissionMode,
    claudeEffortLevel,
    claudeModel,
    persistConversationMetadata,
    projectContext,
    resetStreamingState,
    scheduleStreamingContentUpdate,
    settings.autopilotMode,
    failStreamingTurn,
  ]);

  const {
    sendMessage,
    cancelPendingMessage,
    regenerateResponse,
    continueResponse,
  } = useSendPipeline({
    conversation,
    conversationStorageScope,
    projectContext,
    currentModel,
    currentModelSupportsVision,
    chatEngine,
    claudeModel,
    claudeSession,
    claudePermissionMode,
    claudeEffortLevel,
    isLoading,
    isStreaming,
    isMemoryEnabled,
    reasoningBudget,
    pendingMessages,
    settings,
    activeConversationIdRef,
    optimisticAssistantIdRef,
    abortControllerRef,
    isSummarizingRef,
    sendMessageRef,
    setConversation,
    setDisplayedMessages,
    setPendingMessages,
    setStreamingMessageId,
    setContextTokens,
    setContextLimit,
    setIsSummarizing,
    setIsLoading,
    setError,
    agentChat,
    appendToDisplayedMessages,
    getOrCreateConversation,
    resetStreamingState,
    persistConversationMetadata,
    runClaudeTurn,
    getContextLimit,
  });

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
  const {
    createNewConversation,
    loadConversationById,
    updateTitle,
    forkConversationToStudio,
    editMessage,
    editMessageAndRegenerate,
    deleteMessageById,
    setModel,
    clearChat,
    abortGeneration,
    enableMemoryForConversation,
  } = useConversationActions({
    conversation,
    conversationStorageScope,
    projectContext,
    currentModel,
    claudeModel,
    isLoading,
    isStreaming,
    reasoningBudget,
    settings,
    activeConversationIdRef,
    optimisticAssistantIdRef,
    fullContentRef,
    latestStreamingContentRef,
    conversationCreationRef,
    pendingProjectContextRef,
    isSummarizingRef,
    abortControllerRef,
    setConversation,
    setConversationStorageScopeState,
    setDisplayedMessages,
    setPendingMessages,
    setHasMoreMessages,
    setMessageOffset,
    setCurrentModel,
    setChatEngineState,
    setContextTokens,
    setContextLimit,
    setSessionTasks,
    setProjectContextState,
    setActiveToolCalls,
    setIsSummarizing,
    setIsMemoryEnabled,
    setIsLoading,
    setIsStreaming,
    setStreamingContent,
    setStreamingMessageId,
    setError,
    agentChat,
    appendToDisplayedMessages,
    loadInitialMessages,
    resetStreamingState,
    resetPermittedTools,
    getContextLimit,
  });

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
      <ManagementAccessModal
        kind={managementPrompt?.kind ?? null}
        onResolve={resolveManagementAccess}
      />
    </ChatContext.Provider>
  );
}
