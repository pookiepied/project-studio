import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { ChatConversation, ClaudeSessionMetadata } from "@/types";
import type { ChatEngine, ClaudeEffortLevel } from "@/cliBridges/types";
import type { ConversationStorageScope } from "@/core/conversations";
import type { PermissionModeId } from "@/core/permissions";
import { saveConversation } from "@/features/chat/conversations/chatHistoryService";
import {
  canContinueWithEngine,
  isClaudeOwnedConversation,
  normalizeEngineForConversationOwner,
} from "@/features/chat/conversations/ownership/conversationOwnership";
import {
  getPreferredChatEngine,
  savePreferredChatEngine,
} from "@/features/chat/conversations/preferences/chatEnginePreference";

interface UseChatEngineStateOptions {
  conversation: ChatConversation | null;
  currentModel: string;
  getContextLimit: (modelId: string) => number;
  setConversation: Dispatch<SetStateAction<ChatConversation | null>>;
  setContextLimit: Dispatch<SetStateAction<number>>;
  setError: Dispatch<SetStateAction<string | null>>;
}

export function useChatEngineState({
  conversation,
  currentModel,
  getContextLimit,
  setConversation,
  setContextLimit,
  setError,
}: UseChatEngineStateOptions) {
  const [conversationStorageScope, setConversationStorageScopeState] =
    useState<ConversationStorageScope>("cloud");
  const [chatEngine, setChatEngineState] = useState<ChatEngine>("studio");
  const [claudeModel, setClaudeModelState] = useState("sonnet");
  const [claudeSession, setClaudeSession] = useState<ClaudeSessionMetadata | null>(null);
  const [claudePermissionMode, setClaudePermissionModeState] = useState<PermissionModeId>("default");
  const [claudeEffortLevel, setClaudeEffortLevelState] = useState<ClaudeEffortLevel>("medium");

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
  }, [setConversation]);

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
  }, [
    conversation,
    conversationStorageScope,
    setError,
    claudeModel,
    currentModel,
    getContextLimit,
    setContextLimit,
    setConversation,
  ]);

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
  }, [
    claudeModel,
    currentModel,
    getContextLimit,
    setContextLimit,
  ]);

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
  }, [conversation, getContextLimit, setContextLimit, setConversation]);

  useEffect(() => {
    if (!conversation) {
      setChatEngineState(conversationStorageScope === "local" ? getPreferredChatEngine() ?? "studio" : "studio");
      setClaudeSession(null);
      return;
    }
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
    if (nextClaude?.effortLevel) setClaudeEffortLevelState(nextClaude.effortLevel as ClaudeEffortLevel);
  // conversation id/metadata slices are the trigger; full object would re-fire on unrelated mutations
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversation?.id, conversation?.metadata, conversationStorageScope]);

  useEffect(() => {
    const activeModelId = chatEngine === "claude" ? claudeModel : currentModel;
    setContextLimit(getContextLimit(activeModelId));
  }, [chatEngine, claudeModel, currentModel, getContextLimit, setContextLimit]);

  return {
    conversationStorageScope,
    setConversationStorageScope,
    setConversationStorageScopeState,
    chatEngine,
    setChatEngine,
    setChatEngineState,
    claudeModel,
    setClaudeModel,
    setClaudeModelState,
    claudeSession,
    setClaudeSession,
    claudePermissionMode,
    setClaudePermissionModeState,
    claudeEffortLevel,
    setClaudeEffortLevelState,
    persistConversationMetadata,
  };
}
