/**
 * ChatContext constants and tool classification sets.
 *
 * Centralised so the same definitions are shared between the provider,
 * the tool executor, and any other module that needs them.
 */

// ---------------------------------------------------------------------------
// Context window limits
// ---------------------------------------------------------------------------

/** Maximum number of raw messages to pull from storage before token-pruning. */
export const MAX_CONTEXT_MESSAGES = 50;

/** Default context token budget (used when model data is unavailable). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 6000;

/** Page size for lazy message loading in the UI. */
export const MESSAGES_PER_PAGE = 20;

// ---------------------------------------------------------------------------
// Tool display classification
// ---------------------------------------------------------------------------

/**
 * Tools that render silently — no card shown in the chat bubble.
 * These are "meta" tools that affect system state without producing
 * visible output the user needs to see.
 */
export const SILENT_TOOLS = new Set([
  "think",
  "expand_tools",
  "skip_question",
  "claude_code",
  "skill_read",
  "current_time",
  "sleep",
]);

/**
 * Cloud tools that render as a compact pill/capsule card.
 * Everything else either renders as a stream card (Studio Harness tools)
 * or falls through to the default capsule.
 */
export const CAPSULE_NATIVE_TOOLS = new Set([
  "web_search",
  "web_fetch",
  "http_request",
  "memory_read",
  "memory_write",
  "memory_update",
  "memory_delete",
  "memory_list",
  "image_generate",
  "video_generate",
  "rag",
  "task_write",
  "spawn_agent",
  "ask_user_question",
]);

// Permission gating no longer lives here. Every local tool call is classified
// and gated by the centralized permission engine (`src/permissions/`) via
// `evaluateToolCall`, driven by `toolRisk.ts` — not by a hardcoded name set.
