/**
 * Permission domain model.
 *
 * The typed vocabulary the enforcement engine speaks. Every value here is
 * derived from TRUSTED APP STATE (conversation scope, persisted grants, user
 * settings) - never from model-supplied tool arguments. The engine
 * (`engine.ts`) consumes a `PermissionContext` and returns a
 * `PermissionDecision`; nothing in this file reaches into React, storage, or
 * the network, so it stays pure and unit-testable.
 *
 * This is deliberately separate from `config.ts`/`types.ts`, which describe the
 * CLI-bridge *permission mode* vocabulary (Ask / AcceptEdits / Plan / Bypass)
 * surfaced to Claude Code. That is a labelling concern for external engines;
 * this is the runtime enforcement model for local MCP tools.
 */

import type { ToolRiskClass } from "./toolRisk";

// ---------------------------------------------------------------------------
// Scope dimensions
// ---------------------------------------------------------------------------

/** Where the conversation stores + runs. Mirrors `ConversationStorageScope`. */
export type ChatMode = "cloud" | "local";

/**
 * Sub-context of a LOCAL conversation:
 *   - "global"  - no workspace selected; access is machine-wide and must be
 *                 explicitly granted (broad, risky).
 *   - "project" - a workspace/folder is open; access is bounded to its root
 *                 and gated by workspace trust.
 * `null` when `chatMode === "cloud"`.
 */
export type LocalContext = "global" | "project";

/** VS Code-style workspace trust decision, persisted per folder identity. */
export type WorkspaceTrust = "trusted" | "untrusted" | "unknown";

/**
 * How actions are approved within the granted scope:
 *   - "review"     - prompt before sensitive/mutating actions.
 *   - "autonomous" - run approved capabilities without per-action prompts,
 *                    still subject to hard high-risk floors.
 */
export type ActionMode = "review" | "autonomous";

/** How long / how widely a user approval persists. */
export type GrantScope = "once" | "session" | "workspace" | "global";

/**
 * A management-permission category. Distinct from per-tool risk: gates whole
 * classes of first-party system action rather than an individual file/computer
 * tool. One grant covers every operation in the category.
 *   - "mcp"   - install / configure MCP servers (the mcp-management server)
 *   - "skill" - create / modify skills (the skill-management server)
 */
export type ManagementKind = "mcp" | "skill";

// ---------------------------------------------------------------------------
// Decision result
// ---------------------------------------------------------------------------

type PermissionOutcome = "allow" | "prompt" | "deny";

/** Machine-readable reason a call was blocked outright. */
export type PermissionDenyCode =
  | "cloud_scope"          // local tool requested inside a cloud conversation
  | "mcp_disabled"         // the owning MCP server is not enabled
  | "untrusted_workspace"; // mutating action inside an untrusted workspace
// Note: a path escaping the granted root(s) no longer denies — it escalates to a
// machine-wide grant prompt (global_access_required). See engine.ts rule 3.

/** Machine-readable reason a call needs interactive approval. */
export type PermissionPromptCode =
  | "review_required"        // review mode + a sensitive/mutating action
  | "autonomous_floor"       // high-risk action that even autonomy must confirm
  | "global_access_required"; // global (no-project) chat needs machine-wide file access

type PermissionReasonCode =
  | "ok"
  | PermissionDenyCode
  | PermissionPromptCode;

export interface PermissionDecision {
  outcome: PermissionOutcome;
  /** Stable code for logging, tests, and UI branching. */
  code: PermissionReasonCode;
  /** LLM/human-readable explanation (safe to return as a tool error). */
  reason: string;
  /** Risk class of the tool, for the approval UI and audit logging. */
  riskClass: ToolRiskClass;
  /** For `prompt` outcomes: the grant scopes the user may choose from. */
  offeredScopes?: GrantScope[];
}

// ---------------------------------------------------------------------------
// Engine input
// ---------------------------------------------------------------------------

/**
 * A read-only lookup of already-granted tools for the current call, resolved
 * from session + workspace + global grant stores BEFORE the engine runs. Keeps
 * the engine pure - it never touches storage itself.
 */
export interface GrantLookup {
  has(toolName: string): boolean;
}

/**
 * The complete, trusted input to a single permission decision. Assembled by the
 * caller (ChatProvider / toolExecutor) from conversation state + `grants.ts`.
 * `args` is included ONLY so the engine can read a tool's *target path* for
 * root-boundary checks - never to read a permission flag from the model.
 */
export interface PermissionContext {
  chatMode: ChatMode;
  localContext: LocalContext | null;
  /** MCP server that owns the tool (e.g. "studio-harness", "computer-use"). */
  server: string;
  toolName: string;
  /** Model-supplied arguments. Untrusted - inspected for paths, nothing else. */
  args: Record<string, unknown>;
  /** Whether the owning MCP server is enabled by user preference. */
  mcpEnabled: boolean;
  /** Absolute path of the open workspace, or null in global/cloud contexts. */
  workspaceRoot: string | null;
  workspaceTrust: WorkspaceTrust;
  /** Roots the agent may operate within (typically `[workspaceRoot]`). */
  grantedRoots: string[];
  /** True when the user has granted broad machine-wide access. */
  hasGlobalGrant: boolean;
  actionMode: ActionMode;
  /** Tools already approved for session/workspace/global scope. */
  existingGrants: GrantLookup;
}
