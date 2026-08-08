/**
 * Timeouts for the interactive gates in local tool execution.
 *
 * Each gate blocks the agent turn on a human answer. Without a ceiling the
 * cloud turn hangs forever when the user walks away, so every gate races the
 * prompt against one of these and falls back to a safe default (deny / decline).
 *
 * The values live in `core/connection/types.ts` (CONNECTION_TIMEOUTS), which is
 * the single source of truth for every timeout in the app — these are named
 * re-exports, not new numbers (audit B10).
 */

import { CONNECTION_TIMEOUTS } from "@/core/connection";

/** `ask_user_question` — user never answered; return a safe fallback string. */
export const ANSWER_TIMEOUT_MS = CONNECTION_TIMEOUTS.TOOL_ANSWER_TIMEOUT_MS;

/** Tool-approval prompt — auto-deny so the turn does not hang. */
export const APPROVAL_TIMEOUT_MS = CONNECTION_TIMEOUTS.TOOL_APPROVAL_TIMEOUT_MS;

/** Machine-wide (global) access request — auto-deny. */
export const GLOBAL_ACCESS_TIMEOUT_MS = CONNECTION_TIMEOUTS.TOOL_GLOBAL_ACCESS_TIMEOUT_MS;
