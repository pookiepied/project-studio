/**
 * MCP exposure scope - the coarse "should this server be visible at all?" layer.
 *
 * This is the canonical home for the cloud/local boundary. Studio Harness and
 * Computer Use run on the user's machine, so they must never be advertised to
 * or invoked from a cloud conversation. That rule lives here, in the permission
 * module, rather than being duplicated across chat-request builders and the
 * execution engine.
 *
 * Two distinct enforcement points consume this:
 *   1. Tool-list assembly (`buildChatRequest`) filters local servers out of the
 *      list sent to the cloud worker, so the model is never even offered them.
 *   2. The permission engine (`engine.ts`) denies any local call that somehow
 *      reaches execution in a cloud conversation - defence in depth.
 */

import type { ConversationStorageScope } from "../core/storage/chatHistoryService";
import type { ChatMode, LocalContext } from "./model";

/**
 * Canonical set of local-only MCP server names. Single source of truth for the
 * scope boundary. The richer per-server runtime defs (start command, permission
 * key, display name) live in `services/local/localMcpControl.ts`; those `name`
 * fields must stay in step with this set.
 */
export const LOCAL_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
  "studio-harness",
  "computer-use",
]);

/** True if `server` is a local-only MCP server (machine-bound). */
export function isLocalMcpServer(server: string): boolean {
  return LOCAL_MCP_SERVER_NAMES.has(server);
}

/** Map conversation storage scope onto the permission `ChatMode`. */
export function chatModeFromStorageScope(scope: ConversationStorageScope): ChatMode {
  return scope === "local" ? "local" : "cloud";
}

/** Whether local machine capabilities are permitted in this conversation. */
export function allowsLocalCapabilities(scope: ConversationStorageScope): boolean {
  return chatModeFromStorageScope(scope) === "local";
}

/**
 * Derive the local sub-context from the presence of an open project. A selected
 * workspace ⇒ project chat (bounded to its root); none ⇒ global local chat.
 * Returns `null` for cloud conversations.
 */
export function deriveLocalContext(
  scope: ConversationStorageScope,
  hasProject: boolean
): LocalContext | null {
  if (!allowsLocalCapabilities(scope)) return null;
  return hasProject ? "project" : "global";
}

/**
 * Strip local-only servers from a running-server list for cloud conversations.
 * A local conversation keeps the full list.
 */
export function filterMcpServersForConversationScope(
  servers: string[],
  scope: ConversationStorageScope
): string[] {
  if (allowsLocalCapabilities(scope)) return servers;
  return servers.filter((server) => !isLocalMcpServer(server));
}
