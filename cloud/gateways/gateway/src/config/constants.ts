export const API_PREFIX = "/v1";
export const VERSION = "1.0.0";
export const WORKER_NAME = "gateway";

export const STUDIO_SITE_URL  = "https://studio.pookiepied.dev";
export const STUDIO_APP_TITLE = "STUDIO";

export const FILE_LIMITS = {
  MAX_AUDIO_FILE_SIZE: 25 * 1024 * 1024,
  MAX_IMAGE_FILE_SIZE: 20 * 1024 * 1024,
} as const;

export const CACHE_CONFIG = {
  MODELS_TTL: 6 * 60 * 60 * 1000,
  MODELS_KV_KEY: "models_cache",
} as const;

export const SUPPORTED_AUDIO_TYPES = [
  "audio/webm",
  "audio/wav",
  "audio/mp3",
  "audio/mpeg",
  "audio/m4a",
  "audio/mp4",
] as const;

export const STREAM_CONFIG = {
  ENABLED: true,
} as const;
