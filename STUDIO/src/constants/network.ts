/**
 * Network, API, storage-key, and security constants.
 *
 * Split out of the historical config/constants.ts monolith during Phase 5 (T5.1)
 * per the §2 placement rule. Co-located siblings: app.ts, ui.ts, models.ts,
 * splashTiming.ts — all re-exported by `constants/index.ts`.
 */

// Network Configuration
export const NETWORK_CONFIG = {
  /** API health check interval */
  HEALTH_CHECK_INTERVAL_MS: 30 * 1000, // 30 seconds

  /** Request timeout */
  REQUEST_TIMEOUT_MS: 30 * 1000, // 30 seconds

  /** Maximum retry attempts */
  MAX_RETRY_ATTEMPTS: 3,

  /** Base delay for exponential backoff */
  RETRY_BASE_DELAY_MS: 1000, // 1 second

  /** Maximum delay for exponential backoff */
  RETRY_MAX_DELAY_MS: 30 * 1000, // 30 seconds
} as const;

// API Endpoints (relative paths)
export const API_PATHS = {
  AUTH: '/auth',
  CHAT: '/chat',
  MODELS: '/models',
  AUDIO: '/audio',
  HEALTH: '/health',
} as const;

// Storage Keys
export const STORAGE_KEYS = {
  ACCESS_TOKEN: 'studio_access_token',
  REFRESH_TOKEN: 'studio_refresh_token',
  USER_INFO: 'studio_user_info',
  INSTALLATION_SALT: 'studio_installation_salt',
  MODELS_CACHE: 'studio_models_cache',
  MODELS_CACHE_TIMESTAMP: 'studio_models_cache_timestamp',
  SETTINGS: 'studio_settings',
  THEME: 'studio_theme',
} as const;

// Security Configuration
export const SECURITY_CONFIG = {
  /** Maximum input length to prevent DoS */
  MAX_INPUT_LENGTH: 50000, // 50K characters

  /** Maximum file name length */
  MAX_FILENAME_LENGTH: 255,

  /** Encryption algorithm */
  ENCRYPTION_ALGORITHM: 'AES-GCM',

  /** Encryption key length in bits */
  ENCRYPTION_KEY_LENGTH: 256,

  /** Salt length in bytes */
  SALT_LENGTH: 32,
} as const;
