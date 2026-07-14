export const ErrorCode = {
  INVALID_URL: "INVALID_URL",
  VIDEO_NOT_FOUND: "VIDEO_NOT_FOUND",
  VIDEO_UNAVAILABLE: "VIDEO_UNAVAILABLE",
  NO_CAPTIONS: "NO_CAPTIONS",
  NO_AUDIO: "NO_AUDIO",
  MUSIC_ONLY: "MUSIC_ONLY",
  AUDIO_FETCH_FAILED: "AUDIO_FETCH_FAILED",
  STT_FAILED: "STT_FAILED",
  STT_NOT_CONFIGURED: "STT_NOT_CONFIGURED",
  RATE_LIMITED: "RATE_LIMITED",
  PARSE_ERROR: "PARSE_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export const ErrorMessages: Record<ErrorCode, string> = {
  INVALID_URL:
    "The URL provided is not a recognized YouTube video URL. Supported formats include youtube.com/watch?v=, youtu.be/, youtube.com/shorts/, and country-specific variants.",
  VIDEO_NOT_FOUND:
    "The video could not be found. It may be private, deleted, or the URL may be incorrect.",
  VIDEO_UNAVAILABLE:
    "This video is not available. It may be age-restricted, region-blocked, or removed.",
  NO_CAPTIONS:
    "No captions are available for this video and no speech-to-text service is configured. To enable audio transcription, set STT_PROVIDER_URL + STT_PROVIDER_API_KEY (standalone) or STT_PROVIDER_NAME with the AI service binding (bound mode).",
  NO_AUDIO:
    "This video has no audio content. It may be a screen recording, slideshow, or a video with only visuals.",
  MUSIC_ONLY:
    "This video appears to contain music or ambient sound with no detectable speech. A readable transcript could not be produced.",
  AUDIO_FETCH_FAILED:
    "The audio stream could not be retrieved. This video may use YouTube's signature cipher protection, which requires client-side decryption.",
  STT_FAILED:
    "The speech-to-text transcription attempt failed. The STT service may be unavailable or the audio format may be unsupported.",
  STT_NOT_CONFIGURED:
    "No captions are available for this video, and no speech-to-text provider is configured. Set STT_PROVIDER_URL + STT_PROVIDER_API_KEY (standalone) or STT_PROVIDER_NAME with the AI service binding (bound mode) to enable audio transcription as a fallback.",
  RATE_LIMITED:
    "YouTube has rate-limited this request. Please try again in a few minutes.",
  PARSE_ERROR:
    "The video page could not be parsed. YouTube may have updated their page structure.",
};

export class YtMcpError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message?: string) {
    super(message ?? ErrorMessages[code]);
    this.name = "YtMcpError";
    this.code = code;
  }
}

export interface TranscriptSuccess {
  transcript: string;
  source: "manual" | "auto_generated" | "whisper";
  language_detected: string;
  title: string | null;
  duration_seconds: number | null;
  processing_note: string | null;
}

export interface TranscriptFailure {
  transcript: null;
  code: ErrorCode;
  message: string;
}

export type TranscriptResult = TranscriptSuccess | TranscriptFailure;

export interface VideoInfoSuccess {
  title: string;
  channel: string;
  duration_seconds: number | null;
  description: string;
  available_caption_languages: string[];
  has_audio: boolean;
  is_live: boolean;
}

export interface VideoInfoFailure {
  error: true;
  code: ErrorCode;
  message: string;
}

export type VideoInfoResult = VideoInfoSuccess | VideoInfoFailure;

export function failureResult(code: ErrorCode, override?: string): TranscriptFailure {
  return { transcript: null, code, message: override ?? ErrorMessages[code] };
}

export function infoFailureResult(code: ErrorCode, override?: string): VideoInfoFailure {
  return { error: true, code, message: override ?? ErrorMessages[code] };
}
