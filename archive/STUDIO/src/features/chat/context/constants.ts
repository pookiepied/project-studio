/**
 * ChatContext constants.
 */

/** Maximum number of raw messages to pull from storage before token-pruning. */
export const MAX_CONTEXT_MESSAGES = 50;

/** Default context token budget (used when model data is unavailable). */
export const DEFAULT_MAX_CONTEXT_TOKENS = 6000;

/** Page size for lazy message loading in the UI. */
export const MESSAGES_PER_PAGE = 20;
