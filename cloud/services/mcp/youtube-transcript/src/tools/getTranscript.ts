import { MIN_SPEECH_TRANSCRIPT_CHARS } from "../constants";
import { Env } from "../env";
import {
  ErrorCode,
  TranscriptResult,
  YtMcpError,
  failureResult,
} from "../errors";
import { track } from "../lib/tracker";
import { logger } from "../logger";
import {
  fetchCaptionText,
  fetchPlayerResponse,
  getAsrTracks,
  getManualTracks,
  selectTrack,
} from "../providers/captions";
import { transcribeAudio } from "../providers/whisper";
import {
  extractAudioUrl,
  getContentLengthBytes,
  hasAudioTrack,
} from "../utils/audioStream";
import { extractVideoId } from "../utils/videoId";

export interface GetTranscriptParams {
  url: string;
  preferred_language?: string | null;
}

export async function getTranscript(
  params: GetTranscriptParams,
  env: Env
): Promise<TranscriptResult> {
  const { url, preferred_language } = params;

  // 1. Parse URL
  const videoId = extractVideoId(url);
  if (!videoId) {
    logger.warn("getTranscript: invalid URL", { url });
    return failureResult(ErrorCode.INVALID_URL);
  }

  track(env, {
    event: "transcript.request",
    category: "transcript",
    data: { videoId, preferred_language: preferred_language ?? null },
  });

  // 2. Fetch player response
  let playerResponse: Awaited<ReturnType<typeof fetchPlayerResponse>>;
  try {
    playerResponse = await fetchPlayerResponse(videoId);
  } catch (e) {
    if (e instanceof YtMcpError) {
      logger.warn("getTranscript: player fetch error", { videoId, code: e.code });
      track(env, {
        event: "transcript.error",
        category: "transcript",
        severity: "warn",
        data: { videoId, code: e.code },
      });
      return failureResult(e.code, e.message);
    }
    logger.error("getTranscript: unexpected error", { videoId, error: String(e) });
    return failureResult(ErrorCode.PARSE_ERROR);
  }

  // 3. Check playability
  const playStatus = playerResponse.playabilityStatus?.status;
  if (playStatus && playStatus !== "OK") {
    const reason = playerResponse.playabilityStatus?.reason;
    const code =
      playStatus === "LOGIN_REQUIRED"
        ? ErrorCode.VIDEO_UNAVAILABLE
        : ErrorCode.VIDEO_NOT_FOUND;
    logger.warn("getTranscript: video not playable", { videoId, playStatus, reason });
    return failureResult(code, reason);
  }

  // 4. Extract video metadata for the response
  const details = playerResponse.videoDetails;
  const title = details?.title ?? null;
  const durationSeconds = details?.lengthSeconds
    ? parseInt(details.lengthSeconds, 10)
    : null;

  // 5. Layer 1 — manual (creator-uploaded) captions
  const manualTracks = getManualTracks(playerResponse);
  const selectedManual = selectTrack(manualTracks, preferred_language);

  if (selectedManual) {
    try {
      const transcript = await fetchCaptionText(selectedManual.baseUrl);
      if (transcript.length > 0) {
        logger.info("getTranscript: served from manual captions", {
          videoId,
          lang: selectedManual.languageCode,
        });
        track(env, {
          event: "transcript.layer_used",
          category: "transcript",
          data: { videoId, layer: "manual", lang: selectedManual.languageCode },
        });
        return {
          transcript,
          source: "manual",
          language_detected: selectedManual.languageCode,
          title,
          duration_seconds: durationSeconds,
          processing_note: null,
        };
      }
    } catch (e) {
      logger.warn("getTranscript: manual caption fetch failed, falling through", {
        videoId,
        error: String(e),
      });
      track(env, {
        event: "transcript.fallback",
        category: "transcript",
        data: { videoId, from: "manual", reason: String(e) },
      });
    }
  }

  // 6. Layer 2 — auto-generated (ASR) captions
  const asrTracks = getAsrTracks(playerResponse);
  const selectedAsr = selectTrack(asrTracks, preferred_language);

  if (selectedAsr) {
    try {
      const transcript = await fetchCaptionText(selectedAsr.baseUrl);
      if (transcript.length > 0) {
        logger.info("getTranscript: served from ASR captions", {
          videoId,
          lang: selectedAsr.languageCode,
        });
        track(env, {
          event: "transcript.layer_used",
          category: "transcript",
          data: { videoId, layer: "auto_generated", lang: selectedAsr.languageCode },
        });
        return {
          transcript,
          source: "auto_generated",
          language_detected: selectedAsr.languageCode,
          title,
          duration_seconds: durationSeconds,
          processing_note: null,
        };
      }
    } catch (e) {
      logger.warn("getTranscript: ASR caption fetch failed, falling through", {
        videoId,
        error: String(e),
      });
      track(env, {
        event: "transcript.fallback",
        category: "transcript",
        data: { videoId, from: "auto_generated", reason: String(e) },
      });
    }
  }

  // 7. No captions available — check if video has audio before attempting Whisper
  const adaptiveFormats = playerResponse.streamingData?.adaptiveFormats ?? [];

  if (!hasAudioTrack(adaptiveFormats)) {
    logger.info("getTranscript: no audio track detected", { videoId });
    track(env, {
      event: "transcript.no_audio",
      category: "transcript",
      data: { videoId },
    });
    return failureResult(ErrorCode.NO_AUDIO);
  }

  // 8. Check if Whisper is configured
  const hasWhisperKey =
    (!!env.AI && !!env.STT_PROVIDER_NAME) ||
    (!!env.STT_PROVIDER_URL && !!env.STT_PROVIDER_API_KEY);
  if (!hasWhisperKey) {
    logger.info("getTranscript: STT not configured, no captions available", { videoId });
    return failureResult(ErrorCode.STT_NOT_CONFIGURED);
  }

  // 9. Layer 3 — Whisper audio transcription
  const audioUrl = extractAudioUrl(adaptiveFormats);
  if (!audioUrl) {
    logger.warn("getTranscript: all audio formats are cipher-protected", { videoId });
    track(env, {
      event: "transcript.error",
      category: "transcript",
      severity: "warn",
      data: { videoId, code: ErrorCode.AUDIO_FETCH_FAILED },
    });
    return failureResult(ErrorCode.AUDIO_FETCH_FAILED);
  }

  const contentBytes = getContentLengthBytes(adaptiveFormats);
  logger.info("getTranscript: attempting Whisper transcription", {
    videoId,
    audioUrl: audioUrl.slice(0, 80),
    estimatedBytes: contentBytes,
  });

  const transcript = await transcribeAudio({ audioUrl, env, language: preferred_language });

  if (transcript === null) {
    track(env, {
      event: "transcript.error",
      category: "transcript",
      severity: "error",
      data: { videoId, code: ErrorCode.STT_FAILED },
    });
    return failureResult(ErrorCode.STT_FAILED);
  }

  if (transcript.length < MIN_SPEECH_TRANSCRIPT_CHARS) {
    logger.info("getTranscript: Whisper returned near-empty result (music/silent)", {
      videoId,
      chars: transcript.length,
    });
    track(env, {
      event: "transcript.music_only",
      category: "transcript",
      data: { videoId, chars: transcript.length },
    });
    return failureResult(ErrorCode.MUSIC_ONLY);
  }

  logger.info("getTranscript: served from Whisper", {
    videoId,
    chars: transcript.length,
  });
  track(env, {
    event: "transcript.layer_used",
    category: "transcript",
    data: { videoId, layer: "whisper", chars: transcript.length },
  });

  return {
    transcript,
    source: "whisper",
    language_detected: preferred_language ?? "auto",
    title,
    duration_seconds: durationSeconds,
    processing_note:
      "This transcript was produced by audio transcription, which takes longer than caption-based methods.",
  };
}
