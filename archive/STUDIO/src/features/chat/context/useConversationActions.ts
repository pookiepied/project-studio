/**
 * Conversation-level actions: create, load, fork, retitle, edit, delete, abort.
 *
 * Extracted verbatim from ChatProvider. These are the operations the UI invokes
 * directly on a conversation, as opposed to the turn machinery in
 * `./useSendPipeline.ts` (outbound) and `./useStreamHandlers.ts` (inbound).
 *
 * State and refs live in the provider and arrive as an explicit deps bundle.
 * Deps are destructured at the top so each `useCallback` closes over the current
 * render's values and every dependency array is unchanged from the original.
 */

import { useCallback } from "react";
import { buildChatBody, getMcpServers } from "@/runtime";
import { extractGeneratedImageIds, deleteRemoteImages } from "@/features/chat/services/generatedImages";
import type { ChatRequestBody } from "@/runtime";
import { memorySystem } from "@/core/storage/memorySystem";
import { errorService } from "@/core/errors/errorService";
import { TAURI_CONFIG } from "@/core/config/tauriConfig";
import {
  saveConversation,
  loadConversation,
  addMessage,
  updateConversationTitle,
  updateMessage,
  deleteMessage,
  truncateMessagesAfter,
  forkConversationToStudio as forkConversationToStudioStorage,
} from "@/features/chat/conversations/chatHistoryService";
import type { ConversationStorageScope } from "@/core/conversations";
import { normalizeEngineForConversationOwner } from "@/features/chat/conversations/ownership/conversationOwnership";
import { getPreferredChatEngine } from "@/features/chat/conversations/preferences/chatEnginePreference";
import { backgroundSessionTracker } from "@/features/chat/conversations/backgroundSessionTracker";
import { clearSessionGrants } from "@/core/permissions";
import { claudeBridgeService } from "@/features/chat/services/claudeBridgeService";
import { fetchPendingCompletion, clearPendingCompletion } from "@/features/chat/services/pendingCompletion";
import {
  buildApiMessages,
  pruneContextByTokens,
  applyAllSystemMessages,
} from "./messageBuilder";
import { maybeCompact } from "./contextCompactor";
import { applyCatchUp } from "./catchUp";
import { getConvProjectCtx, type ProjectCtx } from "./projectContextStorage";
import type { ActiveToolCall, PendingMessage, TaskItem } from "./types";
import type { ChatEngine } from "@/cliBridges/types";
import type { AppSettings, ChatConversation, ChatMessage } from "@/types";

type AgentChat = {
  abort: () => void;
  startTurn: (body: ChatRequestBody, convId?: string) => void;
};

export interface ConversationActionDeps {
  // ── Values ──────────────────────────────────────────────────────────────
  conversation: ChatConversation | null;
  conversationStorageScope: ConversationStorageScope;
  projectContext: ProjectCtx | null;
  currentModel: string;
  claudeModel: string;
  isLoading: boolean;
  isStreaming: boolean;
  reasoningBudget: number | undefined;
  settings: AppSettings;

  // ── Refs ────────────────────────────────────────────────────────────────
  activeConversationIdRef: React.MutableRefObject<string>;
  optimisticAssistantIdRef: React.MutableRefObject<string>;
  fullContentRef: React.MutableRefObject<string>;
  latestStreamingContentRef: React.MutableRefObject<string>;
  conversationCreationRef: React.MutableRefObject<Promise<ChatConversation> | null>;
  pendingProjectContextRef: React.MutableRefObject<ProjectCtx | null>;
  isSummarizingRef: React.MutableRefObject<boolean>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;

  // ── State writers ───────────────────────────────────────────────────────
  setConversation: React.Dispatch<React.SetStateAction<ChatConversation | null>>;
  setConversationStorageScopeState: React.Dispatch<React.SetStateAction<ConversationStorageScope>>;
  setDisplayedMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setPendingMessages: React.Dispatch<React.SetStateAction<PendingMessage[]>>;
  setHasMoreMessages: React.Dispatch<React.SetStateAction<boolean>>;
  setMessageOffset: React.Dispatch<React.SetStateAction<number>>;
  setCurrentModel: React.Dispatch<React.SetStateAction<string>>;
  setChatEngineState: React.Dispatch<React.SetStateAction<ChatEngine>>;
  setContextTokens: React.Dispatch<React.SetStateAction<number>>;
  setContextLimit: React.Dispatch<React.SetStateAction<number>>;
  setSessionTasks: React.Dispatch<React.SetStateAction<TaskItem[]>>;
  setProjectContextState: React.Dispatch<React.SetStateAction<ProjectCtx | null>>;
  setActiveToolCalls: React.Dispatch<React.SetStateAction<ActiveToolCall[]>>;
  setIsSummarizing: React.Dispatch<React.SetStateAction<boolean>>;
  setIsMemoryEnabled: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setIsStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setStreamingContent: React.Dispatch<React.SetStateAction<string>>;
  setStreamingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;

  // ── Collaborators ───────────────────────────────────────────────────────
  agentChat: AgentChat;
  appendToDisplayedMessages: (message: ChatMessage) => void;
  loadInitialMessages: (conversationId: string, totalCount: number) => Promise<void>;
  resetStreamingState: (optimisticAssistantId: string, existingContent?: string) => void;
  resetPermittedTools: () => void;
  getContextLimit: (modelId: string) => number;
}

export interface ConversationActions {
  createNewConversation: (
    scope?: ConversationStorageScope,
    options?: { preserveProject?: boolean }
  ) => Promise<void>;
  loadConversationById: (id: string) => Promise<void>;
  updateTitle: (title: string) => Promise<void>;
  forkConversationToStudio: () => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;
  editMessageAndRegenerate: (messageId: string, newContent: string) => Promise<void>;
  deleteMessageById: (messageId: string) => Promise<void>;
  setModel: (model: string) => void;
  clearChat: () => Promise<void>;
  abortGeneration: () => void;
  enableMemoryForConversation: (enabled: boolean) => Promise<void>;
}

export function useConversationActions(deps: ConversationActionDeps): ConversationActions {
  const {
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
  } = deps;

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    await loadInitialMessages(id, conv.messages.length);
    const limit = getContextLimit(conv.model);
    setContextLimit(limit);
    if (conv.messages.length > 0) {
      const raw = conv.contextSummary !== undefined && conv.summarizedUpToIndex !== undefined
        ? conv.messages.slice(conv.summarizedUpToIndex + 1).slice(-50)
        : conv.messages.slice(-50);
      const objs = raw.map((m) => ({ content: m.content }));
      if (conv.contextSummary) objs.unshift({ content: conv.contextSummary });
      import("@/lib/tokenEstimator").then(({ countMessageTokensAsync: c }) =>
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation, getContextLimit, loadInitialMessages, appendToDisplayedMessages]);

  const updateTitle = useCallback(async (title: string) => {
    if (!conversation) return;
    await updateConversationTitle(conversation.id, title);
    const updated = await loadConversation(conversation.id);
    if (updated) setConversation(updated);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation]);

  const setModel = useCallback((model: string) => {
    setCurrentModel(model);
    setContextLimit(getContextLimit(model));
    if (conversation) { conversation.model = model; saveConversation(conversation); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation, getContextLimit]);

  const clearChat = useCallback(() => createNewConversation(), [createNewConversation]);

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentChat]);

  const enableMemoryForConversation = useCallback(async (enabled: boolean) => {
    setIsMemoryEnabled(enabled);
    if (conversation) {
      await memorySystem.setConversationShared(conversation.id, enabled);
      if (enabled) await memorySystem.processConversation(conversation);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation]);

  return {
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
  };
}
