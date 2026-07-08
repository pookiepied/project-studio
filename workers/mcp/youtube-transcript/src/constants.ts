export const DEFAULT_STT_MODEL = "whisper-large-v3-turbo";

export const PAGE_FETCH_TIMEOUT_MS = 12_000;
export const CAPTION_FETCH_TIMEOUT_MS = 10_000;
export const AUDIO_FETCH_TIMEOUT_MS = 25_000;
export const STT_REQUEST_TIMEOUT_MS = 30_000;

export const MIN_SPEECH_TRANSCRIPT_CHARS = 30;
export const MAX_TRANSCRIPT_CHARS = 100_000;

export const STT_MAX_FILE_BYTES = 25 * 1024 * 1024;

export const PAGE_FETCH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
};
