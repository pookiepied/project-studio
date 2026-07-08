/**
 * Permission grant store - the durable + session-scoped source of truth for
 * everything the engine treats as "already decided by the user":
 *
 *   - workspace trust      (per folder, persistent)
 *   - action mode          (per workspace + a global default, persistent)
 *   - global machine grant (persistent)
 *   - per-tool grants       (session / workspace / global)
 *
 * MCP server *enablement* is intentionally NOT here - that lives in
 * `services/local/localMcpControl.ts` (the process-start gate). This module is
 * only about what the agent is allowed to DO once a server is running.
 *
 * Persistent state uses `localStorage` under a single `perm:` namespace so it
 * is easy to inspect and clear. Session grants live in memory and reset on
 * reload. All reads fail safe: unknown -> most restrictive.
 */

import type { GrantLookup, GrantScope, WorkspaceTrust } from "./model";

const NS = "perm:";

// ---------------------------------------------------------------------------
// Workspace identity
// ---------------------------------------------------------------------------

/**
 * Stable id for a workspace, derived from its root path. Case-insensitive and
 * separator-normalised so the same folder maps to one identity across sessions
 * and platforms.
 */
export function workspaceId(root: string): string {
  return root.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
}

// ---------------------------------------------------------------------------
// Low-level storage helpers (fail-safe)
// ---------------------------------------------------------------------------

function read(key: string): string | null {
  try {
    return localStorage.getItem(NS + key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(NS + key, value);
  } catch {
    /* storage unavailable - grant simply won't persist */
  }
}

function readJsonArray(key: string): string[] {
  const raw = read(key);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function remove(key: string): void {
  try {
    localStorage.removeItem(NS + key);
  } catch {
    /* storage unavailable */
  }
}

/** All `perm:`-namespaced storage keys, with the namespace stripped. */
function namespacedKeys(): string[] {
  const keys: string[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(NS)) keys.push(k.slice(NS.length));
    }
  } catch {
    /* storage unavailable */
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Workspace trust
// ---------------------------------------------------------------------------

export function getWorkspaceTrust(root: string | null): WorkspaceTrust {
  if (!root) return "unknown";
  const v = read(`trust:${workspaceId(root)}`);
  if (v === "trusted") return "trusted";
  if (v === "untrusted") return "untrusted";
  return "unknown";
}

export function setWorkspaceTrust(root: string, trust: WorkspaceTrust): void {
  if (trust === "unknown") return;
  write(`trust:${workspaceId(root)}`, trust);
}

// Action mode (review / autonomous) is NOT stored here - it lives on the
// conversation's `projectContext.accessMode` (per-project) with the global
// autopilot setting as the fallback, so there is a single source of truth the
// in-chat toggle already drives. Keeping it out of this store avoids a
// duplicate mode that could drift from the UI control.

// ---------------------------------------------------------------------------
// Global machine-access grant
// ---------------------------------------------------------------------------

export function hasGlobalGrant(conversationId: string | null | undefined): boolean {
  if (!conversationId) return false;
  return read(`globalGrant:conv:${conversationId}`) === "1";
}

export function setGlobalGrant(
  granted: boolean,
  conversationId: string | null | undefined
): void {
  if (!conversationId) return;
  const key = `globalGrant:conv:${conversationId}`;
  if (granted) write(key, "1");
  else remove(key);
}

// ---------------------------------------------------------------------------
// Per-tool grants (session / workspace / global)
// ---------------------------------------------------------------------------

/** In-memory grants for the current app run only. Cleared on reload. */
const sessionGrants = new Map<string, Set<string>>();

function conversationGrantKey(conversationId: string | null | undefined): string {
  return conversationId ?? "__unknown_conversation__";
}

/** Clear all session grants (e.g. when the user starts a fresh conversation). */
export function clearSessionGrants(): void {
  sessionGrants.clear();
}

/**
 * Record a user approval at the chosen scope.
 *   - once      -> not stored (single call already proceeds)
 *   - session   -> in-memory set
 *   - workspace -> persisted under the workspace id
 *   - global    -> persisted globally
 */
export function recordGrant(
  toolName: string,
  scope: GrantScope,
  root: string | null,
  conversationId?: string | null
): void {
  switch (scope) {
    case "once":
      return;
    case "session": {
      const key = conversationGrantKey(conversationId);
      const grants = sessionGrants.get(key) ?? new Set<string>();
      grants.add(toolName);
      sessionGrants.set(key, grants);
      return;
    }
    case "workspace": {
      if (!root) {
        const key = conversationGrantKey(conversationId);
        const grants = sessionGrants.get(key) ?? new Set<string>();
        grants.add(toolName);
        sessionGrants.set(key, grants);
        return;
      }
      const key = `grants:ws:${workspaceId(root)}`;
      const list = new Set(readJsonArray(key));
      list.add(toolName);
      write(key, JSON.stringify([...list]));
      return;
    }
    case "global": {
      const list = new Set(readJsonArray("grants:global"));
      list.add(toolName);
      write("grants:global", JSON.stringify([...list]));
      return;
    }
  }
}

/**
 * Build the flattened {@link GrantLookup} the engine consumes: a tool counts as
 * granted if it was approved for the session, for this workspace, or globally.
 */
export function buildGrantLookup(root: string | null): GrantLookup {
  return buildGrantLookupForConversation(root, null);
}

export function buildGrantLookupForConversation(
  root: string | null,
  conversationId: string | null | undefined
): GrantLookup {
  const workspaceSet = root
    ? new Set(readJsonArray(`grants:ws:${workspaceId(root)}`))
    : new Set<string>();
  const globalSet = new Set(readJsonArray("grants:global"));
  const conversationSet = sessionGrants.get(conversationGrantKey(conversationId)) ?? new Set<string>();
  return {
    has: (toolName: string) =>
      conversationSet.has(toolName) ||
      workspaceSet.has(toolName) ||
      globalSet.has(toolName),
  };
}

// ---------------------------------------------------------------------------
// Management / inspection (Settings > Permissions panel)
// ---------------------------------------------------------------------------
//
// The panel needs to *enumerate* and *revoke* what the write-side functions
// above record. These read the same `perm:` namespace so the two views can
// never drift. All are fail-safe: a storage error yields an empty result.

/** A trusted / distrusted workspace remembered across sessions. */
export interface WorkspaceTrustEntry {
  /** Normalised workspace id (also its stored root path, lower-cased). */
  id: string;
  trust: WorkspaceTrust;
}

/** Every workspace with a persisted trust decision. */
export function listWorkspaceTrust(): WorkspaceTrustEntry[] {
  const entries: WorkspaceTrustEntry[] = [];
  for (const key of namespacedKeys()) {
    if (!key.startsWith("trust:")) continue;
    const v = read(key);
    const trust: WorkspaceTrust =
      v === "trusted" ? "trusted" : v === "untrusted" ? "untrusted" : "unknown";
    if (trust !== "unknown") entries.push({ id: key.slice("trust:".length), trust });
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id));
}

/** Forget a workspace's trust decision (it will re-prompt next time it opens). */
export function revokeWorkspaceTrust(id: string): void {
  remove(`trust:${id}`);
}

/** Tools the user has approved for all workspaces (`global` grant scope). */
export function listGlobalToolGrants(): string[] {
  return readJsonArray("grants:global").sort();
}

export interface GlobalMachineGrantEntry {
  conversationId: string;
}

export function listGlobalMachineGrants(): GlobalMachineGrantEntry[] {
  return namespacedKeys()
    .filter((key) => key.startsWith("globalGrant:conv:") && read(key) === "1")
    .map((key) => ({ conversationId: key.slice("globalGrant:conv:".length) }))
    .sort((a, b) => a.conversationId.localeCompare(b.conversationId));
}

export function revokeGlobalMachineGrant(conversationId: string): void {
  remove(`globalGrant:conv:${conversationId}`);
}

/** Per-workspace tool approvals (`workspace` grant scope). */
export function listWorkspaceToolGrants(): { workspaceId: string; tools: string[] }[] {
  const out: { workspaceId: string; tools: string[] }[] = [];
  for (const key of namespacedKeys()) {
    if (!key.startsWith("grants:ws:")) continue;
    const tools = readJsonArray(key).sort();
    if (tools.length > 0) out.push({ workspaceId: key.slice("grants:ws:".length), tools });
  }
  return out.sort((a, b) => a.workspaceId.localeCompare(b.workspaceId));
}

/**
 * Revoke a single persisted tool grant. `root` targets a workspace grant; omit
 * it (or pass null) to revoke the global grant for that tool.
 */
export function revokeToolGrant(toolName: string, root: string | null): void {
  const key = root ? `grants:ws:${workspaceId(root)}` : "grants:global";
  const next = readJsonArray(key).filter((t) => t !== toolName);
  if (next.length > 0) write(key, JSON.stringify(next));
  else remove(key);
}

/** Revoke every persisted grant + trust + the global machine grant at once. */
export function clearAllPermissions(): void {
  for (const key of namespacedKeys()) remove(key);
  sessionGrants.clear();
}
