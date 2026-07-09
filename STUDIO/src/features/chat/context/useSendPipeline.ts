/**
 * The outbound half of a chat turn: sending, queueing, regenerating, continuing.
 *
 * Extracted verbatim from ChatProvider. Routes each turn to one of the engines
 * — Claude Code (`./runClaudeTurn.ts`) or Studio over the Local Runtime's
 * WebSocket (`agentChat.startTurn`) — and owns the optimistic-UI bookkeeping
 * and the pending-message queue that drains when a stream ends.
 *
 * State and refs live in the provider and arrive as an explicit deps bundle.
 * Deps are destructured at the top so each `useCallback` closes over the current
 * render's values and every dependency array is unchanged from the original.
 */

import { useCallback, useEffect, useRef } from "react";
import { buildChatBody, getMcpServers } from "@/runtime";
import type { ChatRequestBody } from "@/runtime";
import { aiService } from "@/features/chat/services/aiService";
import { tokenManager } from "@/lib/tokenManager";
import { memorySystem } from "@/core/storage/memorySystem";
import { errorService } from "@/core/errors/errorService";
import { handleNetworkFailure } from "@/core/network/fallbackService";
import { parseChatResponse, isValidChatResponse } from "@/lib/chatParser";
import { extractMessageText } from "@/types/chat";
import {
  loadConversation,
  addMessage,
  getContextMessages,
} from "@/core/storage/chatHistoryService";
import type { ConversationStorageScope } from "@/core/storage/chatHistoryService";
import { isClaudeOwnedConversation } from "@/features/chat/conversations/ownership/conversationOwnership";
import { buildSendContext } from "./buildSendContext";
import {
  buildApiMessages,
  pruneContextByTokens,
  applyAllSystemMessages,
} from "./messageBuilder";
import { maybeCompact } from "./contextCompactor";
import { MAX_CONTEXT_MESSAGES } from "./constants";
import type { PendingMessage } from "./types";
import type { ProjectCtx } from "./projectContextStorage";
import type { ChatEngine, ClaudeEffortLevel } from "@/cliBridges/types";
import type { PermissionModeId } from "@/core/permissions";
import type { FileAttachment } from "@/features/chat/attachments/fileAttachmentService";
import type {
  AppSettings,
  ChatConversation,
  ChatMessage,
  ClaudeSessionMetadata,
} from "@/types";
import type { APIChatMessage } from "@/types/chat";

/** The slice of `useAgentChat` this pipeline drives. */
type AgentChat = { startTurn: (body: ChatRequestBody, convId?: string) => void };

export interface SendPipelineDeps {
  // ── Values ──────────────────────────────────────────────────────────────
  conversation: ChatConversation | null;
  conversationStorageScope: ConversationStorageScope;
  projectContext: ProjectCtx | null;
  currentModel: string;
  currentModelSupportsVision: boolean;
  chatEngine: ChatEngine;
  claudeModel: string;
  claudeSession: ClaudeSessionMetadata | null;
  claudePermissionMode: PermissionModeId;
  claudeEffortLevel: ClaudeEffortLevel;
  isLoading: boolean;
  isStreaming: boolean;
  isMemoryEnabled: boolean;
  reasoningBudget: number | undefined;
  pendingMessages: PendingMessage[];
  settings: AppSettings;

  // ── Refs ────────────────────────────────────────────────────────────────
  activeConversationIdRef: React.MutableRefObject<string>;
  optimisticAssistantIdRef: React.MutableRefObject<string>;
  abortControllerRef: React.MutableRefObject<AbortController | null>;
  isSummarizingRef: React.MutableRefObject<boolean>;
  sendMessageRef: React.MutableRefObject<
    ((content: string, useStreaming?: boolean, attachments?: FileAttachment[]) => Promise<void>) | null
  >;

  // ── State writers ───────────────────────────────────────────────────────
  setConversation: React.Dispatch<React.SetStateAction<ChatConversation | null>>;
  setDisplayedMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  setPendingMessages: React.Dispatch<React.SetStateAction<PendingMessage[]>>;
  setStreamingMessageId: React.Dispatch<React.SetStateAction<string | null>>;
  setContextTokens: React.Dispatch<React.SetStateAction<number>>;
  setContextLimit: React.Dispatch<React.SetStateAction<number>>;
  setIsSummarizing: React.Dispatch<React.SetStateAction<boolean>>;
  setIsLoading: React.Dispatch<React.SetStateAction<boolean>>;
  setError: React.Dispatch<React.SetStateAction<string | null>>;

  // ── Collaborators ───────────────────────────────────────────────────────
  agentChat: AgentChat;
  appendToDisplayedMessages: (message: ChatMessage) => void;
  getOrCreateConversation: (content: string, model: string) => Promise<ChatConversation>;
  resetStreamingState: (optimisticAssistantId: string, existingContent?: string) => void;
  persistConversationMetadata: (
    conv: ChatConversation,
    provider: ChatEngine,
    nextClaude?: ClaudeSessionMetadata | null
  ) => Promise<ChatConversation>;
  runClaudeTurn: (
    activeConversation: ChatConversation,
    prompt: string,
    optimisticAssistantId: string
  ) => Promise<void>;
  getContextLimit: (modelId: string) => number;
}

export interface SendPipeline {
  sendMessage: (content: string, useStreaming?: boolean, attachments?: FileAttachment[]) => Promise<void>;
  cancelPendingMessage: (index: number) => void;
  regenerateResponse: () => Promise<void>;
  continueResponse: () => Promise<void>;
}

export function useSendPipeline(deps: SendPipelineDeps): SendPipeline {
  const {
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
  } = deps;

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
  }, [isStreaming, pendingMessages]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Roll back the optimistic user + assistant bubbles and surface `message`.
   * Every early-exit in sendMessage that happens *after* the optimistic render
   * but *before* a turn starts funnels through here.
   */
  const abortOptimisticSend = useCallback(
    (message: string, optimisticId: string, optimisticAsst: string) => {
      setError(message);
      setIsLoading(false);
      setDisplayedMessages((prev) =>
        prev.filter((m) => m.id !== optimisticId && m.id !== optimisticAsst)
      );
      setStreamingMessageId(null);
    },
    [] // eslint-disable-line react-hooks/exhaustive-deps
  );

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
      abortOptimisticSend(
        "Selected model doesn't support images. Please choose a vision model.",
        optimisticId, optimisticAsst
      );
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
      abortOptimisticSend(nf.userMessage, optimisticId, optimisticAsst);
      return;
    }

    // ── Save user message ────────────────────────────────────────────────
    const activeIsClaudeOwned = isClaudeOwnedConversation(activeConversation);
    if (activeIsClaudeOwned && chatEngine !== "claude") {
      abortOptimisticSend(
        "This is a Claude Code native conversation. Continue with Claude, or fork it into Studio first.",
        optimisticId, optimisticAsst
      );
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
      abortOptimisticSend(`Failed to save message: ${nf.userMessage}`, optimisticId, optimisticAsst);
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
    // Dep list is the original's, verbatim. The "missing" deps ESLint wants are
    // all refs and setState fns — stable, but it can't prove that once they
    // arrive through a deps bundle rather than useRef/useState in this scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    claudeSession, claudeModel, currentModel, isLoading, isStreaming, currentModelSupportsVision,
    isMemoryEnabled, getContextLimit, appendToDisplayedMessages, resetStreamingState,
    persistConversationMetadata, projectContext, chatEngine, runClaudeTurn, settings, reasoningBudget, agentChat, getOrCreateConversation,
    claudePermissionMode, claudeEffortLevel, conversationStorageScope, abortOptimisticSend,
  ]);

  // Keep ref in sync so the pending-queue drain effect can call sendMessage without
  // capturing a stale closure.
  useEffect(() => {
    sendMessageRef.current = sendMessage;
  }, [sendMessage]); // eslint-disable-line react-hooks/exhaustive-deps

  const cancelPendingMessage = useCallback((index: number) => {
    setPendingMessages((prev) => prev.filter((_, i) => i !== index));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [currentModel, reasoningBudget, agentChat, resetStreamingState, conversationStorageScope]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [conversation, currentModel, isLoading, getContextLimit, settings, projectContext, chatEngine, streamAndSaveResponse, conversationStorageScope]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [appendToDisplayedMessages, conversation, currentModel, getContextLimit, isLoading, projectContext, chatEngine, runClaudeTurn, settings, streamAndSaveResponse, conversationStorageScope]); // eslint-disable-line react-hooks/exhaustive-deps

  return { sendMessage, cancelPendingMessage, regenerateResponse, continueResponse };
}
