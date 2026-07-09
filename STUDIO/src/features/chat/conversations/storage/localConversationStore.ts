import { invoke } from "@tauri-apps/api/core";
import type { ChatConversation } from "@/types";
import { logger } from "@/core/logging/logger";
import type { ConversationIndex, ConversationIndexEntry, ConversationStore } from "./types";
import {
  getLocalConversationDir,
  getLocalConversationIndexPath,
  getLocalConversationMessagesPath,
  getLocalConversationSnapshotPath,
  getLocalConversationTranscriptPath,
  getStudioConversationRoot,
} from "./localConversationPaths";
import {
  LOCAL_CONVERSATION_SCHEMA_VERSION,
  renderConversationTranscript,
  serializeMessagesJsonl,
  withLocalConversationMetadata,
} from "./localConversationFormat";

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await invoke<string>("read_text_file", { path });
  } catch {
    return null;
  }
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke("write_text_file", { path, content });
}

function emptyIndex(): ConversationIndex {
  return { schemaVersion: LOCAL_CONVERSATION_SCHEMA_VERSION, conversations: [] };
}

function toIndexEntry(conversation: ChatConversation): ConversationIndexEntry {
  return {
    id: conversation.id,
    title: conversation.title,
    model: conversation.model,
    messageCount: conversation.messages.length,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    storageScope: "local",
    provider: conversation.metadata?.provider,
    owner: conversation.metadata?.owner ?? "studio",
    projectPath: conversation.metadata?.project?.path,
    projectName: conversation.metadata?.project?.name,
    projectAccessMode: conversation.metadata?.project?.accessMode,
    claudeSessionId: conversation.metadata?.claude?.sessionId,
    claudeCwd: conversation.metadata?.claude?.cwd,
    claudeProjectKey: conversation.metadata?.claude?.projectKey,
  };
}

function cleanIndex(index: ConversationIndex): ConversationIndex {
  const unique = index.conversations.filter((conv, idx, self) =>
    idx === self.findIndex((candidate) => candidate.id === conv.id)
  );

  return {
    schemaVersion: LOCAL_CONVERSATION_SCHEMA_VERSION,
    conversations: unique
      .map((conv) => ({ ...conv, storageScope: "local" as const, owner: conv.owner ?? "studio" as const }))
      .sort((a, b) => b.updatedAt - a.updatedAt),
  };
}

class LocalConversationStore implements ConversationStore {
  async loadIndex(): Promise<ConversationIndex> {
    let path: string;
    try {
      path = await getLocalConversationIndexPath();
    } catch (error) {
      logger.warn("LocalConversationStore", "Local conversation storage is unavailable", error);
      return emptyIndex();
    }

    const content = await readTextFile(path);
    if (!content) return emptyIndex();

    try {
      const parsed = JSON.parse(content) as Partial<ConversationIndex>;
      return cleanIndex({
        schemaVersion: LOCAL_CONVERSATION_SCHEMA_VERSION,
        conversations: parsed.conversations ?? [],
      });
    } catch (error) {
      logger.warn("LocalConversationStore", "Failed to parse local conversation index", error);
      return emptyIndex();
    }
  }

  async saveIndex(index: ConversationIndex): Promise<void> {
    let path: string;
    try {
      path = await getLocalConversationIndexPath();
    } catch (error) {
      throw new Error(`Local conversation storage is unavailable: ${String(error)}`);
    }

    await writeTextFile(
      path,
      JSON.stringify(cleanIndex(index), null, 2)
    );
  }

  async loadConversation(id: string): Promise<ChatConversation | null> {
    let path: string;
    try {
      path = await getLocalConversationSnapshotPath(id);
    } catch (error) {
      logger.warn("LocalConversationStore", "Local conversation storage is unavailable", error);
      return null;
    }

    const content = await readTextFile(path);
    if (!content) return null;

    try {
      return withLocalConversationMetadata(JSON.parse(content) as ChatConversation);
    } catch (error) {
      logger.warn("LocalConversationStore", `Failed to parse local conversation ${id}`, error);
      return null;
    }
  }

  async saveConversation(conversation: ChatConversation): Promise<void> {
    const scopedConversation = withLocalConversationMetadata(conversation);

    let rootPath: string;
    let conversationDir: string;
    let snapshotPath: string;
    let messagesPath: string;
    let transcriptPath: string;
    try {
      rootPath = await getStudioConversationRoot();
      conversationDir = await getLocalConversationDir(scopedConversation.id);
      snapshotPath = await getLocalConversationSnapshotPath(scopedConversation.id);
      messagesPath = await getLocalConversationMessagesPath(scopedConversation.id);
      transcriptPath = await getLocalConversationTranscriptPath(scopedConversation.id);
    } catch (error) {
      throw new Error(`Local conversation storage is unavailable: ${String(error)}`);
    }

    await invoke("create_directory", { path: rootPath });
    await invoke("create_directory", { path: conversationDir });

    await Promise.all([
      writeTextFile(
        snapshotPath,
        JSON.stringify(scopedConversation, null, 2)
      ),
      writeTextFile(
        messagesPath,
        serializeMessagesJsonl(scopedConversation)
      ),
      writeTextFile(
        transcriptPath,
        renderConversationTranscript(scopedConversation)
      ),
    ]);

    const index = await this.loadIndex();
    const entry = toIndexEntry(scopedConversation);
    const existingIndex = index.conversations.findIndex((conv) => conv.id === entry.id);
    if (existingIndex >= 0) index.conversations[existingIndex] = entry;
    else index.conversations.unshift(entry);
    await this.saveIndex(index);
  }

  async deleteConversation(id: string): Promise<void> {
    try {
      await invoke("delete_directory", { path: await getLocalConversationDir(id) });
    } catch (error) {
      logger.warn("LocalConversationStore", `Failed to delete local conversation ${id}`, error);
    }

    const index = await this.loadIndex();
    index.conversations = index.conversations.filter((conv) => conv.id !== id);
    await this.saveIndex(index);
  }
}

export const localConversationStore = new LocalConversationStore();
