import { Env } from "../env";
import {
  ErrorCode,
  VideoInfoResult,
  YtMcpError,
  infoFailureResult,
} from "../errors";
import { logger } from "../logger";
import {
  fetchPlayerResponse,
  getAllCaptionLanguages,
} from "../providers/captions";
import { hasAudioTrack } from "../utils/audioStream";
import { extractVideoId } from "../utils/videoId";

export interface GetVideoInfoParams {
  url: string;
}

export async function getVideoInfo(
  params: GetVideoInfoParams,
  _env: Env
): Promise<VideoInfoResult> {
  const videoId = extractVideoId(params.url);
  if (!videoId) {
    return infoFailureResult(ErrorCode.INVALID_URL);
  }

  let playerResponse: Awaited<ReturnType<typeof fetchPlayerResponse>>;
  try {
    playerResponse = await fetchPlayerResponse(videoId);
  } catch (e) {
    if (e instanceof YtMcpError) {
      return infoFailureResult(e.code, e.message);
    }
    logger.error("getVideoInfo: unexpected error", { videoId, error: String(e) });
    return infoFailureResult(ErrorCode.PARSE_ERROR);
  }

  const playStatus = playerResponse.playabilityStatus?.status;
  if (playStatus && playStatus !== "OK") {
    const reason = playerResponse.playabilityStatus?.reason;
    const code =
      playStatus === "LOGIN_REQUIRED"
        ? ErrorCode.VIDEO_UNAVAILABLE
        : ErrorCode.VIDEO_NOT_FOUND;
    return infoFailureResult(code, reason);
  }

  const details = playerResponse.videoDetails;
  if (!details) {
    return infoFailureResult(ErrorCode.PARSE_ERROR, "Video details not present in page response");
  }

  const adaptiveFormats = playerResponse.streamingData?.adaptiveFormats ?? [];
  const captionLanguages = getAllCaptionLanguages(playerResponse);

  return {
    title: details.title,
    channel: details.author,
    duration_seconds: details.lengthSeconds
      ? parseInt(details.lengthSeconds, 10)
      : null,
    description: (details.shortDescription ?? "").slice(0, 500),
    available_caption_languages: captionLanguages,
    has_audio: hasAudioTrack(adaptiveFormats),
    is_live: details.isLiveContent ?? false,
  };
}
