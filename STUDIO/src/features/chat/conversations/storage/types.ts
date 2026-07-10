import type { ChatConversation } from "@/types";
import type { ConversationStorageScope } from "@/core/conversations";

export interface ConversationIndexEntry {
  id: string;
  title: string;
  model: string;
  messageCount: number;
  createdAt: number;
  updatedAt: number;
  storageScope?: ConversationStorageScope;
  provider?: "studio" | "cloud" | "claude";
  owner?: "studio" | "claude";
  projectPath?: string;
  projectName?: string;
  projectAccessMode?: "review" | "autonomous";
  claudeSessionId?: string;
  claudeCwd?: string;
  claudeProjectKey?: string;
}

export interface ConversationIndex {
  schemaVersion: 1;
  conversations: ConversationIndexEntry[];
}

export interface ConversationStore {
  loadIndex(): Promise<ConversationIndex>;
  saveIndex(index: ConversationIndex): Promise<void>;
  loadConversation(id: string): Promise<ChatConversation | null>;
  saveConversation(conversation: ChatConversation): Promise<void>;
  deleteConversation(id: string): Promise<void>;
}
