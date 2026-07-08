import { invoke } from "@tauri-apps/api/core";
import type { ChatConversation } from "../../../types";
import type { ConversationIndex } from "../storage/types";
import { logger } from "../../logging/logger";
import {
  getClaudeProjectDir,
  getClaudeProjectKeyFromPath,
  getClaudeProjectsRoot,
  getClaudeTranscriptPath,
  parseClaudeNativeConversationId,
} from "./claudeConversationPaths";
import { parseClaudeTranscript } from "./claudeTranscriptParser";

interface DirectoryEntry {
  name: string;
  path: string;
  isDir: boolean;
  isFile: boolean;
  size: number;
  modifiedMs?: number;
}

const INDEX_CACHE_TTL_MS = 15_000;

interface IndexCacheEntry {
  loadedAt: number;
  index: ConversationIndex;
}

const indexCache = new Map<string, IndexCacheEntry>();
const indexInFlight = new Map<string, Promise<ConversationIndex>>();

async function listDirectory(path: string): Promise<DirectoryEntry[]> {
  try {
    return await invoke<DirectoryEntry[]>("list_directory_entries", { path });
  } catch {
    return [];
  }
}

async function readTextFile(path: string): Promise<string | null> {
  try {
    return await invoke<string>("read_text_file", { path });
  } catch {
    return null;
  }
}

class ClaudeConversationAdapter {
  async loadIndex(options: {
    excludeSessionIds?: Set<string>;
    limit?: number;
    projectPath?: string | null;
  } = {}): Promise<ConversationIndex> {
    const cacheKey = [
      options.projectPath ?? "__all__",
      options.limit ?? 80,
      [...(options.excludeSessionIds ?? new Set<string>())].sort().join(","),
    ].join("|");
    const cached = indexCache.get(cacheKey);
    if (cached && Date.now() - cached.loadedAt < INDEX_CACHE_TTL_MS) {
      return cached.index;
    }
    const inFlight = indexInFlight.get(cacheKey);
    if (inFlight) return inFlight;

    const promise = this.loadIndexUncached(options).then((index) => {
      indexCache.set(cacheKey, { loadedAt: Date.now(), index });
      return index;
    }).finally(() => {
      indexInFlight.delete(cacheKey);
    });

    indexInFlight.set(cacheKey, promise);
    return promise;
  }

  private async loadIndexUncached(options: {
    excludeSessionIds?: Set<string>;
    limit?: number;
    projectPath?: string | null;
  } = {}): Promise<ConversationIndex> {
    let root: string;
    try {
      root = await getClaudeProjectsRoot();
    } catch (error) {
      logger.warn("ClaudeConversationAdapter", "Claude projects root is unavailable", error);
      return { schemaVersion: 1, conversations: [] };
    }

    const projectDirs = options.projectPath
      ? [{
          name: getClaudeProjectKeyFromPath(options.projectPath),
          path: await getClaudeProjectDir(options.projectPath),
          isDir: true,
          isFile: false,
          size: 0,
        }]
      : (await listDirectory(root)).filter((entry) => entry.isDir);
    const transcriptFiles: Array<DirectoryEntry & { projectKey: string; sessionId: string }> = [];

    for (const project of projectDirs) {
      const files = (await listDirectory(project.path)).filter((entry) =>
        entry.isFile && entry.name.endsWith(".jsonl")
      );

      for (const file of files) {
        const sessionId = file.name.replace(/\.jsonl$/i, "");
        if (options.excludeSessionIds?.has(sessionId)) continue;
        transcriptFiles.push({ ...file, projectKey: project.name, sessionId });
      }
    }

    transcriptFiles.sort((a, b) => (b.modifiedMs ?? 0) - (a.modifiedMs ?? 0));
    const limited = transcriptFiles.slice(0, options.limit ?? 80);
    const conversations = [];

    for (const file of limited) {
      const content = await readTextFile(file.path);
      if (!content) continue;

      try {
        const conversation = parseClaudeTranscript(content, {
          projectKey: file.projectKey,
          sessionId: file.sessionId,
          transcriptPath: file.path,
          updatedAt: file.modifiedMs,
        });

        conversations.push({
          id: conversation.id,
          title: conversation.title,
          model: conversation.model,
          messageCount: conversation.messages.length,
          createdAt: conversation.createdAt,
          updatedAt: conversation.updatedAt,
          storageScope: "local" as const,
          owner: "claude" as const,
          provider: "claude" as const,
          claudeSessionId: file.sessionId,
          claudeCwd: conversation.metadata?.claude?.cwd,
          claudeProjectKey: file.projectKey,
        });
      } catch (error) {
        logger.warn("ClaudeConversationAdapter", `Failed to parse Claude transcript ${file.path}`, error);
      }
    }

    return {
      schemaVersion: 1,
      conversations: conversations.sort((a, b) => b.updatedAt - a.updatedAt),
    };
  }

  async loadConversation(id: string): Promise<ChatConversation | null> {
    const parsed = parseClaudeNativeConversationId(id);
    if (!parsed) return null;

    const transcriptPath = await getClaudeTranscriptPath(parsed.projectKey, parsed.sessionId);
    const content = await readTextFile(transcriptPath);
    if (!content) return null;

    return parseClaudeTranscript(content, {
      projectKey: parsed.projectKey,
      sessionId: parsed.sessionId,
      transcriptPath,
    });
  }
}

export const claudeConversationAdapter = new ClaudeConversationAdapter();
