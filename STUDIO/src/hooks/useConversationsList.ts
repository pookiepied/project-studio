import { useState, useEffect, useCallback } from "react";
import {
  getAllConversations,
  deleteConversation,
  loadConversation,
  updateConversationTitle,
  type ConversationStorageScope,
  type ConversationListOptions,
} from "../core/storage/chatHistoryService";
import { TAURI_CONFIG } from "../core/config/tauriConfig";

export interface ConversationMetadata {
  id:           string;
  title:        string;
  model:        string;
  messageCount: number;
  createdAt:    number;
  updatedAt:    number;
  storageScope?: ConversationStorageScope;
  provider?:     "studio" | "cloud" | "claude";
  owner?:        "studio" | "claude";
  projectPath?:  string;
  projectName?:  string;
  projectAccessMode?: "review" | "autonomous";
  claudeSessionId?: string;
  claudeCwd?:       string;
  claudeProjectKey?: string;
}

interface UseConversationsListReturn {
  conversations:        ConversationMetadata[];
  reload:               () => Promise<void>;
  handleDeleteConversation: (
    id:                string,
    currentId:         string | undefined,
    onLoadConversation:(id: string) => Promise<void>,
    onNewConversation: () => void
  ) => Promise<void>;
  handleSaveConvTitle:  (
    id:                string,
    title:             string,
    currentId:         string | undefined,
    onUpdateTitle:     (t: string) => Promise<void>
  ) => Promise<void>;
}

const listCache = new Map<string, ConversationMetadata[]>();

function makeListCacheKey(scope?: ConversationStorageScope, options: ConversationListOptions = {}): string {
  return `${scope ?? "all"}:${options.projectPath ?? "none"}:${options.claudeProjectPath ?? "none"}`;
}

/**
 * Manages loading, reloading, deleting, and renaming conversations in the sidebar list.
 *
 * The parent keeps minimal UI state (open/close, hover, editing).
 * This hook owns the data and mutation logic.
 */
export function useConversationsList(
  scope?: ConversationStorageScope,
  options: ConversationListOptions = {}
): UseConversationsListReturn {
  const projectPath = options.projectPath ?? null;
  const claudeProjectPath = options.claudeProjectPath ?? null;
  const cacheKey = makeListCacheKey(scope, { projectPath, claudeProjectPath });
  const [conversations, setConversations] = useState<ConversationMetadata[]>(
    () => listCache.get(cacheKey) ?? []
  );

  const reload = useCallback(async () => {
    const convs = await getAllConversations(scope, { projectPath, claudeProjectPath });
    listCache.set(cacheKey, convs);
    setConversations(convs);
  }, [scope, projectPath, claudeProjectPath, cacheKey]);

  // Load on mount and scope changes. Immediately swap to the matching cached
  // list (or empty) so Cloud rows never linger inside Local while scanning.
  useEffect(() => {
    let cancelled = false;
    setConversations(listCache.get(cacheKey) ?? []);
    getAllConversations(scope, { projectPath, claudeProjectPath }).then((convs) => {
      if (cancelled) return;
      listCache.set(cacheKey, convs);
      setConversations(convs);
    }).catch(() => {
      if (!cancelled) setConversations(listCache.get(cacheKey) ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [scope, projectPath, claudeProjectPath, cacheKey]);

  // Reload when conversation changes or storage events fire
  useEffect(() => {
    const handler = () => reload();
    window.addEventListener("studio:storage-ready",  handler);
    window.addEventListener("studio:title-updated",  handler);
    return () => {
      window.removeEventListener("studio:storage-ready", handler);
      window.removeEventListener("studio:title-updated", handler);
    };
  }, [reload]);

  const handleDeleteConversation = useCallback(async (
    id:                string,
    currentId:         string | undefined,
    onLoadConversation:(id: string) => Promise<void>,
    onNewConversation: () => void
  ) => {
    // Best-effort: delete any generated images referenced in the conversation
    const conv = await loadConversation(id).catch(() => null);
    if (conv) {
      const re = /\/adapters\/openai\/v1\/images\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/g;
      for (const msg of conv.messages) {
        if (!msg.content) continue;
        const r = new RegExp(re.source, "g");
        let m: RegExpExecArray | null;
        while ((m = r.exec(msg.content)) !== null) {
          fetch(`${TAURI_CONFIG.API_BASE_URL}/adapters/openai/v1/images/${m[1]}`, { method: "DELETE" }).catch(() => {});
        }
      }
    }

    await deleteConversation(id);
    await reload();

    if (id === currentId) {
      const remaining = await getAllConversations(scope, { projectPath, claudeProjectPath });
      if (remaining.length > 0) {
        await onLoadConversation(remaining[0].id);
      } else {
        onNewConversation();
      }
    }
  }, [reload, scope, projectPath, claudeProjectPath]);

  const handleSaveConvTitle = useCallback(async (
    id:            string,
    title:         string,
    currentId:     string | undefined,
    onUpdateTitle: (t: string) => Promise<void>
  ) => {
    if (!title.trim()) return;
    await updateConversationTitle(id, title.trim());
    await reload();
    if (id === currentId) await onUpdateTitle(title.trim());
  }, [reload]);

  return { conversations, reload, handleDeleteConversation, handleSaveConvTitle };
}
