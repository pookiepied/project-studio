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
import type { ChatConversation, ChatMessage }          from "@/types";
import type { AutoRoutedInfo } from "@/types/chat";
import { memorySystem }                                from "@/core/storage/memorySystem";
import { safeIsVisionModel, safeGetContextWindow } from "@/core/network/fallbackService";
import { useSettings }                                 from "@/app/contexts/SettingsContext";
import { useModelsContext as useModels }                from "@/features/models/context";
import {
  createConversation, saveConversation, loadConversation,
  getConversationMessages, updateConversationTitle, getAllConversations,
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
import { DEFAULT_MAX_CONTEXT_TOKENS, MESSAGES_PER_PAGE } from "./constants";
import { maybeCompact }                                from "./contextCompactor";
import { applyCatchUp }                               from "./catchUp";
import { fetchPendingCompletion, clearPendingCompletion } from "@/features/chat/services/pendingCompletion";
import { chat } from "@/features/chat/services/chatService";
import type { ChatEngine, ClaudeEffortLevel } from "@/cliBridges/types";
import { getClaudeContextWindowTokens } from "@/cliBridges";
import type { PermissionModeId, PermissionDecision, ActionMode } from "@/core/permissions";
import {
  evaluateToolCall,
  chatModeFromStorageScope,
  deriveLocalContext,
  getWorkspaceTrust,
  hasGlobalGrant,
  setGlobalGrant,
  buildGrantLookupForConversation,
} from "@/core/permissions";
import { readLocalMcpPermission, getLocalMcpServer } from "@/runtime";
import { GlobalAccessModal } from "@/features/permissions/components/GlobalAccessModal";
import type { ToolApprovalDecision } from "./types";
import { runClaudeTurn as runClaudeTurnDriver } from "./runClaudeTurn";
import { useStreamHandlers } from "./useStreamHandlers";
import { useSendPipeline } from "./useSendPipeline";
import { useConversationActions } from "./useConversationActions";

import {
  saveConvProjectCtx,
  type ProjectCtx,
} from "./projectContextStorage";
import { backgroundSessionTracker } from "@/features/chat/conversations/backgroundSessionTracker";
import { NotificationService } from "@/core/notifications";
import type { PendingMessage } from "./types";
import type { ClaudeSessionMetadata } from "@/types";
import { getAIMode } from "@/core/config/autoMode";

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

  // ── End-of-turn teardown ────────────────────────────────────────────────
  // Returns the provider to idle once a turn has been fully persisted. Both
  // completion paths in handleStreamDone (Claude-owned and Studio-owned) end
  // here, so the reset can never drift between them.
  const finishStreamingTurn = useCallback(() => {
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
  }, []);

  // Tears the turn down to idle and surfaces the failure. Used by both Claude
  // bailout paths (bridge threw / non-zero exit with no content).
  const failStreamingTurn = useCallback((message: string) => {
    setError(message);
    setIsLoading(false);
    setIsStreaming(false);
    setStreamingContent("");
    latestStreamingContentRef.current = "";
    setStreamingMessageId(null);
    setActiveToolCalls([]);
    thinkingContentRef.current = "";
    setThinkingContent("");
  }, []);

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
    pendingToolCallsRef,
    pendingQuestionResolveRef,
    pendingQuestionSegmentIdRef,
    pendingApprovalResolveRef,
    handleStreamDoneRef,
    setConversation,
    setDisplayedMessages,
    setHasMoreMessages,
    setMessageOffset,
    setMessageToolCalls,
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
  });

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
    getMessageToolCalls,
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
    messageToolCalls,
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
    setMessageToolCalls,
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
