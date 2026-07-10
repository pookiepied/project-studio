/**
 * App-wide tuning constants — token/context limits and cache durations.
 *
 * Split out of the historical config/constants.ts monolith during Phase 5 (T5.1)
 * per the §2 placement rule (app-wide static values live in `core/config/constants/`).
 * Co-located siblings: network.ts, splashTiming.ts. The memory/validation/feature-flag
 * groups were removed as unused (RT-020).
 */

// Token and Context Management
export const TOKEN_LIMITS = {
  /** Maximum number of messages to fetch for context */
  MAX_CONTEXT_MESSAGES: 50,

  /** Maximum tokens to use for conversation context (reserve ~2K for output) */
  MAX_CONTEXT_TOKENS: 6000,

  /** Number of messages to load per page in UI */
  MESSAGES_PER_PAGE: 20,

  /** Refresh token this many milliseconds before expiry */
  TOKEN_REFRESH_THRESHOLD: 5 * 60 * 1000, // 5 minutes
} as const;

// Cache Configuration
export const CACHE_CONFIG = {
  /** How long to cache models data */
  MODELS_CACHE_DURATION: 5 * 60 * 1000, // 5 minutes

  /** How long to cache API configuration */
  API_CONFIG_CACHE_DURATION: 10 * 60 * 1000, // 10 minutes

  /** How long to cache user settings */
  SETTINGS_CACHE_DURATION: 60 * 1000, // 1 minute
} as const;
