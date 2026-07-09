/**
 * Model-domain constants — context-window tuning + reservations.
 *
 * Split out of the historical config/constants.ts monolith during Phase 5 (T5.1)
 * per the §2 placement rule. Co-located siblings: app.ts, network.ts, ui.ts,
 * splashTiming.ts — all re-exported by `core/config/constants/index.ts`.
 */

// Model Configuration
export const MODEL_CONFIG = {
  /** Default context window if not specified */
  DEFAULT_CONTEXT_WINDOW: 8000,

  /** Minimum context window for any model */
  MIN_CONTEXT_WINDOW: 2000,

  /** Reserve this percentage for conversation history */
  RESERVE_FOR_CONVERSATION: 0.3,

  /** Reserve this percentage for AI response */
  RESERVE_FOR_RESPONSE: 0.2,

  /** Minimum tokens to reserve for attachments */
  MIN_ATTACHMENT_TOKENS: 1000,
} as const;
