/**
 * App-wide tuning constants — token/context limits, caches, memory, validation, feature flags.
 *
 * Split out of the historical config/constants.ts monolith during Phase 5 (T5.1)
 * per the §2 placement rule (app-wide static values live in `core/config/constants/`).
 * Co-located siblings: network.ts, ui.ts, models.ts, splashTiming.ts — all
 * re-exported by `core/config/constants/index.ts` for ergonomic imports.
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

// Memory Management
export const MEMORY_CONFIG = {
  /** How often to cleanup thinking content */
  THINKING_CLEANUP_INTERVAL_MS: 5 * 60 * 1000, // 5 minutes

  /** Maximum thinking entries to keep in memory */
  MAX_THINKING_ENTRIES: 50,

  /** Maximum conversation history to keep */
  MAX_CONVERSATION_HISTORY: 100,
} as const;

// Validation Rules
export const VALIDATION = {
  /** Minimum password length */
  MIN_PASSWORD_LENGTH: 8,

  /** Maximum email length */
  MAX_EMAIL_LENGTH: 254,

  /** Maximum conversation title length */
  MAX_TITLE_LENGTH: 100,

  /** Maximum message length */
  MAX_MESSAGE_LENGTH: 50000,
} as const;

// Feature Flags
export const FEATURES = {
  /** Enable Ollama integration */
  OLLAMA_INTEGRATION: 'ollamaIntegration',

  /** Enable Faster Whisper */
  FASTER_WHISPER: 'fasterWhisper',

  /** Enable secure storage */
  SECURE_STORAGE: 'secureStorage',

  /** Enable Google redirect flow */
  GOOGLE_REDIRECT: 'googleRedirect',

  /** Enable memory system */
  MEMORY_SYSTEM: 'memorySystem',
} as const;
