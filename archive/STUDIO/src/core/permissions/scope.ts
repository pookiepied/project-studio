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

import type { ConversationStorageScope } from "@/core/conversations";
import type { ChatMode, LocalContext, ManagementKind } from "./model";

/**
 * Safety floor: the always-present local MCP servers. Studio Harness is the
 * connectivity indicator and Computer Use the desktop-automation server; both
 * are machine-bound in every build. Kept as a hardcoded floor so
 * `isLocalMcpServer` is never emptier than this even before the runtime has
 * synced the full set (early calls, unit tests, engine defence-in-depth).
 */
const SEED_LOCAL_MCP_SERVER_NAMES: ReadonlySet<string> = new Set([
  "studio-harness",
  "computer-use",
]);

/**
 * Authoritative set of local (machine-bound) MCP server names. Seeded with the
 * floor above and kept in sync by the runtime via {@link setLocalMcpServerNames}
 * from the bundled server catalogue + the live `mcp_list_running` set.
 *
 * This replaced a hardcoded 2-name constant that drifted from the catalogue: the
 * bundled `mcp-management`, `skill-management`, and `skill-execution` servers ran
 * locally but were invisible here, so they leaked into cloud conversations and
 * bypassed the permission gate. Any server the client actually runs as a local
 * subprocess is machine-bound, so identity is now data-driven, not a literal list.
 */
let localMcpServerNames = new Set<string>(SEED_LOCAL_MCP_SERVER_NAMES);

/**
 * Replace the known set of local (machine-bound) MCP servers. Runtime-driven:
 * called with the bundled catalogue names ∪ the current `mcp_list_running` set.
 * The floor names are always retained so the set cannot shrink below the
 * always-present built-ins.
 */
export function setLocalMcpServerNames(names: Iterable<string>): void {
  localMcpServerNames = new Set<string>([...SEED_LOCAL_MCP_SERVER_NAMES, ...names]);
}

/** True if `server` is a local-only MCP server (machine-bound). */
export function isLocalMcpServer(server: string): boolean {
  return localMcpServerNames.has(server);
}

/**
 * First-party bundled "system" servers whose per-action gating belongs to the
 * (not-yet-built) system-management permission — Scope B — rather than the
 * per-tool file/computer risk engine. They share the `studio-system-mcp-permission`
 * key and auto-start alongside Studio Harness.
 *
 * They are still {@link isLocalMcpServer local} (so they are stripped from cloud
 * conversations and covered by the engine's cloud-scope defence), but the
 * execution-time permission gate skips them for now, preserving their current
 * ungated local behaviour until Scope B introduces mcp-management /
 * skill-management permissions. Removing a name here re-subjects it to the
 * ordinary risk gate.
 */
const SYSTEM_MANAGED_MCP_SERVERS: ReadonlySet<string> = new Set([
  "mcp-management",
  "skill-management",
  "skill-execution",
]);

/**
 * True if `server` is a first-party system server whose approval is handled by
 * the system-management permission instead of the per-tool risk gate.
 */
export function isSystemManagedMcpServer(server: string): boolean {
  return SYSTEM_MANAGED_MCP_SERVERS.has(server);
}

/**
 * Which management-permission category gates a system server, or `null` when the
 * server needs no management grant:
 *   - mcp-management   → "mcp"   (install / configure MCP servers)
 *   - skill-management → "skill" (create / modify skills)
 *   - skill-execution  → null    (reading/running skills is ordinary usage, not
 *                                 management — left ungated)
 */
export function managementKindFor(server: string): ManagementKind | null {
  if (server === "mcp-management") return "mcp";
  if (server === "skill-management") return "skill";
  return null;
}

/** Map conversation storage scope onto the permission `ChatMode`. */
export function chatModeFromStorageScope(scope: ConversationStorageScope): ChatMode {
  return scope === "local" ? "local" : "cloud";
}

/** Whether local machine capabilities are permitted in this conversation. */
function allowsLocalCapabilities(scope: ConversationStorageScope): boolean {
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
