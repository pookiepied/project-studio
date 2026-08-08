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

import type { GrantLookup, GrantScope, ManagementKind, WorkspaceTrust } from "./model";

const NS = "perm:";

// ---------------------------------------------------------------------------
// Workspace identity
// ---------------------------------------------------------------------------

/**
 * Stable id for a workspace, derived from its root path. Case-insensitive and
 * separator-normalised so the same folder maps to one identity across sessions
 * and platforms.
 */
function workspaceId(root: string): string {
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
// Management-permission grants (MCP install / skill authoring)
// ---------------------------------------------------------------------------
//
// A category-wide grant (see ManagementKind): one approval covers every
// operation of that kind. Two lifetimes, mirroring the machine-access grant:
//   - "session" → in-memory, per conversation, cleared on reload
//   - "global"  → persisted under `mgmtGrant:global:<kind>`, applies everywhere
// Reads fail safe (unknown → not granted).

/** In-memory management grants for the current run: conversationId → kinds. */
const sessionManagementGrants = new Map<string, Set<ManagementKind>>();

/** True if the user has approved this management category (session or global). */
export function hasManagementGrant(
  kind: ManagementKind,
  conversationId: string | null | undefined
): boolean {
  if (read(`mgmtGrant:global:${kind}`) === "1") return true;
  return sessionManagementGrants.get(conversationGrantKey(conversationId))?.has(kind) ?? false;
}

/**
 * Record a management-category approval.
 *   - "session" → this conversation only (in-memory)
 *   - "global"  → persisted, every conversation
 */
export function recordManagementGrant(
  kind: ManagementKind,
  scope: "session" | "global",
  conversationId: string | null | undefined
): void {
  if (scope === "global") {
    write(`mgmtGrant:global:${kind}`, "1");
    return;
  }
  const key = conversationGrantKey(conversationId);
  const kinds = sessionManagementGrants.get(key) ?? new Set<ManagementKind>();
  kinds.add(kind);
  sessionManagementGrants.set(key, kinds);
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
  sessionManagementGrants.clear();
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
