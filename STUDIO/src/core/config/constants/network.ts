/**
 * Storage-key constants.
 *
 * Split out of the historical config/constants.ts monolith during Phase 5 (T5.1)
 * per the §2 placement rule. Co-located siblings: app.ts, splashTiming.ts. The
 * network-tuning, API-path, and security groups were removed as unused (RT-020).
 */

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
