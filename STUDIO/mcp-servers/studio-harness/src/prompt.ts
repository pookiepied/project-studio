/**
 * System prompt constants for the local-mcp modules.
 *
 * STUDIO_HARNESS_SYSTEM_MARKER — prefix used as a de-duplication key in
 *   ChatContext.
 * STUDIO_HARNESS_SYSTEM_PROMPT — a one-line identification marker injected as a
 *   system message by ChatContext whenever Studio Harness is connected.
 *
 * All agent-routing guidance, coding rules, and desktop-control instructions
 * that previously lived here have been moved into the cloud Worker's system
 * prompt builder (chat/src/prompts/system.ts → harnessSection /
 * computerUseSection) so they benefit from the Worker's full conditional prompt
 * structure and are never accidentally bypassed by the hasSystemMessage guard.
 *
 * The legacy *_LOCAL_* alias re-exports preserve compatibility with any caller
 * still importing the old names during the migration and will be removed once
 * the frontend import is updated.
 */

export const STUDIO_HARNESS_SYSTEM_MARKER = "[studio-harness:";

export const STUDIO_HARNESS_SYSTEM_PROMPT = `[studio-harness: local machine access enabled]`;

/** @deprecated Use STUDIO_HARNESS_SYSTEM_MARKER. Kept for migration only. */
export const STUDIO_LOCAL_SYSTEM_MARKER = STUDIO_HARNESS_SYSTEM_MARKER;

/** @deprecated Use STUDIO_HARNESS_SYSTEM_PROMPT. Kept for migration only. */
export const STUDIO_LOCAL_SYSTEM_PROMPT = STUDIO_HARNESS_SYSTEM_PROMPT;
