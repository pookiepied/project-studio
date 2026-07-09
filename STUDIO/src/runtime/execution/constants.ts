/**
 * Timeouts for the interactive gates in local tool execution.
 *
 * Each gate blocks the agent turn on a human answer. Without a ceiling the
 * cloud turn hangs forever when the user walks away, so every gate races the
 * prompt against one of these and falls back to a safe default (deny / decline).
 */

/** Shared ceiling for every human-in-the-loop gate below. */
const HUMAN_RESPONSE_TIMEOUT_MS = 5 * 60 * 1000;

/** `ask_user_question` — user never answered; return a safe fallback string. */
export const ANSWER_TIMEOUT_MS = HUMAN_RESPONSE_TIMEOUT_MS;

/** Tool-approval prompt — auto-deny so the turn does not hang. */
export const APPROVAL_TIMEOUT_MS = HUMAN_RESPONSE_TIMEOUT_MS;

/** Machine-wide (global) access request — auto-deny. */
export const GLOBAL_ACCESS_TIMEOUT_MS = HUMAN_RESPONSE_TIMEOUT_MS;
