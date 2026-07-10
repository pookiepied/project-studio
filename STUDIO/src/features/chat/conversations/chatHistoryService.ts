import { ChatConversation, ChatMessage } from "@/types";
import type { ConversationStorageScope } from "@/core/conversations";
import { unifiedStorage } from "@/core/storage/unifiedStorageService";
import { logger } from "@/core/logging/logger";
import { localConversationStore } from "@/features/chat/conversations/storage/localConversationStore";
import type { ConversationIndex } from "@/features/chat/conversations/storage/types";
import { claudeConversationAdapter } from "@/features/chat/conversations/claude/claudeConversationAdapter";
import { parseClaudeNativeConversationId } from "@/features/chat/conversations/claude/claudeConversationPaths";
import { isClaudeOwnedConversation } from "@/features/chat/conversations/ownership/conversationOwnership";

const CHAT_INDEX_PATH = "chats/chat-index.json";

export interface ConversationListOptions {
  projectPath?: string | null;
  claudeProjectPath?: string | null;
}

type ChatIndex = ConversationIndex;
type ConversationProjectMetadata = NonNullable<ChatConversation["metadata"]>["project"];

/**
 * Generate conversation title from first message
 */
function generateTitle(firstMessage: string): string {
  const maxLength = 50;
  const cleaned = firstMessage.trim().replace(/\n/g, " ");
  
  if (cleaned.length <= maxLength) {
    return cleaned;
  }
  
  return cleaned.substring(0, maxLength - 3) + "...";
}

/**
 * Get conversation file path
 */
function getIndexPath(scope: ConversationStorageScope): string {
  return scope === "local" ? "" : CHAT_INDEX_PATH;
}

function inferScopeFromId(id: string): ConversationStorageScope {
  if (parseClaudeNativeConversationId(id)) return "local";
  return id.startsWith("local-chat-") ? "local" : "cloud";
}

function getConversationScope(conversation: ChatConversation): ConversationStorageScope {
  return conversation.metadata?.storageScope ?? inferScopeFromId(conversation.id);
}

function normalizeProjectPath(path?: string | null): string | null {
  const trimmed = path?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function filterLocalConversationIndex(
  conversations: ChatIndex["conversations"],
  projectPath?: string | null
): ChatIndex["conversations"] {
  const normalizedProjectPath = normalizeProjectPath(projectPath);
  return conversations.filter((conv) => {
    const convProjectPath = normalizeProjectPath(conv.projectPath);
    return normalizedProjectPath ? convProjectPath === normalizedProjectPath : !convProjectPath;
  });
}

function getConversationPath(id: string, scope: ConversationStorageScope = inferScopeFromId(id)): string {
  return scope === "local" ? "" : `chats/${id}.json`;
}

/**
 * Load chat index
 */
async function loadIndex(scope: ConversationStorageScope = "cloud"): Promise<ChatIndex> {
  if (scope === "local") return localConversationStore.loadIndex();
  const index = await unifiedStorage.readJSON<ChatIndex>(getIndexPath(scope));
  return index || { schemaVersion: 1, conversations: [] };
}

function getClaimedClaudeSessionIds(index: ChatIndex): Set<string> {
  return new Set(
    index.conversations
      .filter((conv) => conv.owner !== "claude" && conv.claudeSessionId)
      .map((conv) => conv.claudeSessionId as string)
  );
}

/**
 * Save chat index
 */
async function saveIndex(index: ChatIndex, scope: ConversationStorageScope = "cloud"): Promise<void> {
  if (scope === "local") {
    await localConversationStore.saveIndex(index);
    return;
  }

  // Remove duplicates before saving
  const uniqueConversations = index.conversations.filter((conv, idx, self) =>
    idx === self.findIndex((c) => c.id === conv.id)
  );
  
  const cleanedIndex: ChatIndex = {
    schemaVersion: 1,
    conversations: uniqueConversations
  };
  
  await unifiedStorage.writeJSON(getIndexPath(scope), cleanedIndex);
}

/**
 * Create new conversation
 */
export async function createConversation(
  firstMessage: string,
  model: string,
  options: {
    storageScope?: ConversationStorageScope;
    project?: ConversationProjectMetadata;
    provider?: NonNullable<ChatConversation["metadata"]>["provider"];
  } = {}
): Promise<ChatConversation> {
  const now = Date.now();
  const storageScope = options.storageScope ?? "cloud";
  const conversation: ChatConversation = {
    id: `${storageScope === "local" ? "local-chat" : "chat"}-${now}-${Math.random().toString(36).substring(2, 11)}`,
    title: generateTitle(firstMessage),
    model,
    messages: [],
    createdAt: now,
    updatedAt: now,
    metadata: {
      storageScope,
      owner: "studio",
      provider: options.provider ?? "studio",
      ...(options.project && storageScope === "local" ? { project: options.project } : {}),
    },
  };
  
  await saveConversation(conversation);
  
  // Update index
  const index = await loadIndex(storageScope);
  index.conversations.unshift({
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    messageCount: 0,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    storageScope,
    provider: conversation.metadata?.provider,
    owner: "studio",
    projectPath: conversation.metadata?.project?.path,
    projectName: conversation.metadata?.project?.name,
    projectAccessMode: conversation.metadata?.project?.accessMode,
  });
  await saveIndex(index, storageScope);
  
  return conversation;
}

/**
 * Save conversation to storage
 */
export async function saveConversation(conversation: ChatConversation): Promise<void> {
  if (isClaudeOwnedConversation(conversation)) return;

  const storageScope = getConversationScope(conversation);
  const scopedConversation: ChatConversation = {
    ...conversation,
    metadata: {
      ...(conversation.metadata ?? {}),
      storageScope,
      owner: conversation.metadata?.owner ?? "studio",
    },
  };

  if (storageScope === "local") {
    await localConversationStore.saveConversation(scopedConversation);
    return;
  }

  const conversationPath = getConversationPath(scopedConversation.id, storageScope);
  await unifiedStorage.writeJSON(conversationPath, scopedConversation);
  
  // Update index
  const index = await loadIndex(storageScope);
  const existingIndex = index.conversations.findIndex((c) => c.id === scopedConversation.id);
  
  const metadata = {
    id: scopedConversation.id,
    title: scopedConversation.title,
    model: scopedConversation.model,
    messageCount: scopedConversation.messages.length,
    createdAt: scopedConversation.createdAt,
    updatedAt: scopedConversation.updatedAt,
    storageScope,
    provider: scopedConversation.metadata?.provider,
    owner: scopedConversation.metadata?.owner ?? "studio",
    projectPath: scopedConversation.metadata?.project?.path,
    projectName: scopedConversation.metadata?.project?.name,
    projectAccessMode: scopedConversation.metadata?.project?.accessMode,
    claudeSessionId: scopedConversation.metadata?.claude?.sessionId,
    claudeCwd: scopedConversation.metadata?.claude?.cwd,
    claudeProjectKey: scopedConversation.metadata?.claude?.projectKey,
  };
  
  if (existingIndex >= 0) {
    index.conversations[existingIndex] = metadata;
  } else {
    index.conversations.unshift(metadata);
  }
  
  await saveIndex(index, storageScope);
}

/**
 * Load conversation from storage
 */
export async function loadConversation(id: string): Promise<ChatConversation | null> {
  if (parseClaudeNativeConversationId(id)) {
    return claudeConversationAdapter.loadConversation(id);
  }

  const preferredScope = inferScopeFromId(id);
  if (preferredScope === "local") {
    const local = await localConversationStore.loadConversation(id);
    if (local) return local;
    return await unifiedStorage.readJSON<ChatConversation>(getConversationPath(id, "cloud"));
  }
  const preferred = await unifiedStorage.readJSON<ChatConversation>(getConversationPath(id, preferredScope));
  if (preferred) return preferred;
  return localConversationStore.loadConversation(id);
}

/**
 * Get all conversation metadata (for list view)
 */
export async function getAllConversations(
  scope?: ConversationStorageScope,
  options: ConversationListOptions = {}
): Promise<ChatIndex["conversations"]> {
  if (scope) {
    const index = await loadIndex(scope);
    if (scope === "local") {
      const localConversations = filterLocalConversationIndex(index.conversations, options.projectPath);
      const claude = options.claudeProjectPath
        ? await claudeConversationAdapter.loadIndex({
            excludeSessionIds: getClaimedClaudeSessionIds(index),
            projectPath: options.claudeProjectPath,
          })
        : { schemaVersion: 1 as const, conversations: [] };
      return [
        ...localConversations.map((conv) => ({
          ...conv,
          storageScope: conv.storageScope ?? scope,
          owner: conv.owner ?? ("studio" as const),
        })),
        ...claude.conversations,
      ].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return index.conversations.map((conv) => ({ ...conv, storageScope: conv.storageScope ?? scope }));
  }
  const [cloud, local] = await Promise.all([loadIndex("cloud"), loadIndex("local")]);
  const claude = options.claudeProjectPath
    ? await claudeConversationAdapter.loadIndex({
        excludeSessionIds: getClaimedClaudeSessionIds(local),
        projectPath: options.claudeProjectPath,
      })
    : { schemaVersion: 1 as const, conversations: [] };
  return [
    ...cloud.conversations.map((conv) => ({ ...conv, storageScope: conv.storageScope ?? ("cloud" as const) })),
    ...filterLocalConversationIndex(local.conversations, options.projectPath).map((conv) => ({
      ...conv,
      storageScope: conv.storageScope ?? ("local" as const),
      owner: conv.owner ?? ("studio" as const),
    })),
    ...claude.conversations,
  ].sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * Delete conversation
 */
export async function deleteConversation(id: string): Promise<void> {
  if (parseClaudeNativeConversationId(id)) return;

  const storageScope = inferScopeFromId(id);
  if (storageScope === "local") {
    await localConversationStore.deleteConversation(id);
    return;
  }

  const conversationPath = getConversationPath(id, storageScope);
  await unifiedStorage.remove(conversationPath);
  
  // Update index
  const index = await loadIndex(storageScope);
  index.conversations = index.conversations.filter((c) => c.id !== id);
  await saveIndex(index, storageScope);
}

/**
 * Add message to conversation
 */
export async function addMessage(
  conversationId: string,
  message: Omit<ChatMessage, "id" | "timestamp"> & { id?: string; timestamp?: number }
): Promise<void> {
  const conversation = await loadConversation(conversationId);
  if (!conversation || isClaudeOwnedConversation(conversation)) return;
  
  const newMessage: ChatMessage = {
    ...message,
    id: message.id || `msg-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`,
    timestamp: message.timestamp || Date.now(),
  };
  
  conversation.messages.push(newMessage);
  conversation.updatedAt = Date.now();
  
  await saveConversation(conversation);
}

/**
 * Update conversation title
 */
export async function updateConversationTitle(id: string, title: string): Promise<void> {
  const conversation = await loadConversation(id);
  if (!conversation || isClaudeOwnedConversation(conversation)) return;
  
  conversation.title = title;
  conversation.updatedAt = Date.now();
  
  await saveConversation(conversation);
}

/**
 * Update message content (for editing)
 */
export async function updateMessage(
  conversationId: string,
  messageId: string,
  newContent: string
): Promise<void> {
  const conversation = await loadConversation(conversationId);
  if (!conversation || isClaudeOwnedConversation(conversation)) return;
  
  const messageIndex = conversation.messages.findIndex((m) => m.id === messageId);
  if (messageIndex === -1) return;
  
  conversation.messages[messageIndex].content = newContent;
  conversation.updatedAt = Date.now();
  
  await saveConversation(conversation);
}

/**
 * Delete message from conversation
 */
export async function deleteMessage(
  conversationId: string,
  messageId: string
): Promise<void> {
  const conversation = await loadConversation(conversationId);
  if (!conversation || isClaudeOwnedConversation(conversation)) return;
  
  conversation.messages = conversation.messages.filter((m) => m.id !== messageId);
  conversation.updatedAt = Date.now();
  
  await saveConversation(conversation);
}

/**
 * Remove all messages after the given message (used by edit+regenerate).
 */
export async function truncateMessagesAfter(
  conversationId: string,
  messageId: string
): Promise<void> {
  const conversation = await loadConversation(conversationId);
  if (!conversation || isClaudeOwnedConversation(conversation)) return;

  const idx = conversation.messages.findIndex((m) => m.id === messageId);
  if (idx === -1) return;

  conversation.messages = conversation.messages.slice(0, idx + 1);
  conversation.updatedAt = Date.now();

  await saveConversation(conversation);
}

/**
 * Regenerate AI response (delete last assistant message and resend)
 */
export async function regenerateLastResponse(conversationId: string): Promise<ChatMessage[]> {
  const conversation = await loadConversation(conversationId);
  if (!conversation) return [];
  if (isClaudeOwnedConversation(conversation)) return conversation.messages;
  
  // Find last assistant message (iterate backwards)
  let lastAssistantIndex = -1;
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    if (conversation.messages[i].role === "assistant") {
      lastAssistantIndex = i;
      break;
    }
  }
  
  if (lastAssistantIndex === -1) return conversation.messages;
  
  // Remove it
  conversation.messages.splice(lastAssistantIndex, 1);
  conversation.updatedAt = Date.now();
  
  await saveConversation(conversation);
  
  return conversation.messages;
}

/**
 * Export conversation as JSON
 */
export async function exportConversation(id: string): Promise<string | null> {
  const conversation = await loadConversation(id);
  if (!conversation) return null;
  
  return JSON.stringify(conversation, null, 2);
}

export async function forkConversationToStudio(id: string): Promise<ChatConversation | null> {
  const source = await loadConversation(id);
  if (!source) return null;

  const now = Date.now();
  const claudeCwd = source.metadata?.claude?.cwd;
  const conversation: ChatConversation = {
    ...source,
    id: `local-chat-${now}-${Math.random().toString(36).substring(2, 11)}`,
    title: `Fork: ${source.title}`,
    createdAt: now,
    updatedAt: now,
    metadata: {
      ...(source.metadata ?? {}),
      storageScope: "local",
      provider: "studio",
      owner: "studio",
      ...(source.metadata?.project
        ? { project: source.metadata.project }
        : claudeCwd
        ? {
            project: {
              path: claudeCwd,
              name: claudeCwd.replace(/\\/g, "/").split("/").filter(Boolean).pop() ?? claudeCwd,
            },
          }
        : {}),
      forkedFrom: {
        owner: source.metadata?.owner ?? "studio",
        conversationId: source.id,
        sessionId: source.metadata?.claude?.sessionId,
        cwd: claudeCwd,
      },
      claude: undefined,
    },
  };

  await saveConversation(conversation);
  return conversation;
}

/**
 * Import conversation from JSON
 */
export async function importConversation(jsonData: string): Promise<boolean> {
  try {
    const conversation: ChatConversation = JSON.parse(jsonData);
    
    if (!conversation.id || !conversation.messages || !Array.isArray(conversation.messages)) {
      return false;
    }
    
    conversation.id = `chat-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    conversation.updatedAt = Date.now();
    
    await saveConversation(conversation);
    return true;
  } catch (error) {
    logger.error('ChatHistory', 'Failed to import conversation', error);
    return false;
  }
}

/**
 * Get conversation messages with pagination (for lazy loading)
 */
export async function getConversationMessages(
  id: string,
  limit: number = 20,
  offset: number = 0
): Promise<ChatMessage[]> {
  const conversation = await loadConversation(id);
  if (!conversation) return [];
  
  // Return messages in reverse order (newest first) with pagination
  const reversed = [...conversation.messages].reverse();
  return reversed.slice(offset, offset + limit);
}

/**
 * Get last N messages for context (used when sending to AI)
 */
export async function getContextMessages(
  id: string,
  count: number = 20
): Promise<ChatMessage[]> {
  const conversation = await loadConversation(id);
  if (!conversation) return [];

  // Return last N messages in correct order (oldest first)
  return conversation.messages.slice(-count);
}

/**
 * Persist a rolling context summary for a conversation.
 * Called by the summarization background task in ChatContext.
 */
export async function updateConversationSummary(
  id: string,
  summary: string,
  summarizedUpToIndex: number
): Promise<void> {
  const conversation = await loadConversation(id);
  if (!conversation || isClaudeOwnedConversation(conversation)) return;

  conversation.contextSummary = summary;
  conversation.summarizedUpToIndex = summarizedUpToIndex;
  conversation.updatedAt = Date.now();

  await saveConversation(conversation);
}

