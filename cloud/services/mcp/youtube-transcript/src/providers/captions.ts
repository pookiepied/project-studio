import {
  CAPTION_FETCH_TIMEOUT_MS,
  PAGE_FETCH_HEADERS,
  PAGE_FETCH_TIMEOUT_MS,
} from "../constants";
import { ErrorCode, YtMcpError } from "../errors";
import { logger } from "../logger";
import { AudioFormat } from "../utils/audioStream";
import { parseJson3Captions, parseXmlCaptions } from "../utils/xmlParser";

// ---------------------------------------------------------------------------
// YouTube player response types
// ---------------------------------------------------------------------------

interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  kind: string;       // "asr" = auto-generated, "" or absent = manual
  name: { simpleText: string };
  isTranslatable?: boolean;
}

interface PlayerCaptionsRenderer {
  captionTracks?: CaptionTrack[];
}

export interface PlayerResponse {
  videoDetails?: {
    videoId: string;
    title: string;
    author: string;
    lengthSeconds: string;
    shortDescription: string;
    isLiveContent: boolean;
  };
  captions?: {
    playerCaptionsTracklistRenderer?: PlayerCaptionsRenderer;
  };
  streamingData?: {
    adaptiveFormats?: AudioFormat[];
  };
  playabilityStatus?: {
    status: string;   // "OK" | "UNPLAYABLE" | "ERROR" | "LOGIN_REQUIRED" | etc.
    reason?: string;
  };
}

// ---------------------------------------------------------------------------
// Page fetch and player response extraction
// ---------------------------------------------------------------------------

export async function fetchPlayerResponse(videoId: string): Promise<PlayerResponse> {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=en&gl=US`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: PAGE_FETCH_HEADERS,
      signal: AbortSignal.timeout(PAGE_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    logger.error("captions: page fetch failed", { videoId, error: String(e) });
    throw new YtMcpError(ErrorCode.PARSE_ERROR, `Could not reach YouTube: ${String(e)}`);
  }

  if (response.status === 404) {
    throw new YtMcpError(ErrorCode.VIDEO_NOT_FOUND);
  }
  if (response.status === 429) {
    throw new YtMcpError(ErrorCode.RATE_LIMITED);
  }
  if (!response.ok) {
    throw new YtMcpError(
      ErrorCode.PARSE_ERROR,
      `YouTube returned HTTP ${response.status}`
    );
  }

  const html = await response.text();
  return extractPlayerResponse(html, videoId);
}

function extractPlayerResponse(html: string, videoId: string): PlayerResponse {
  const marker = "var ytInitialPlayerResponse = ";
  const altMarker = "ytInitialPlayerResponse = ";
  let startIdx = html.indexOf(marker);

  if (startIdx !== -1) {
    startIdx += marker.length;
  } else {
    const altIdx = html.indexOf(altMarker);
    if (altIdx === -1) {
      logger.warn("captions: ytInitialPlayerResponse not found in page", { videoId });
      throw new YtMcpError(ErrorCode.PARSE_ERROR);
    }
    startIdx = altIdx + altMarker.length;
  }

  const jsonStr = extractJsonObject(html, startIdx);
  try {
    return JSON.parse(jsonStr) as PlayerResponse;
  } catch {
    logger.warn("captions: JSON.parse failed on player response", { videoId });
    throw new YtMcpError(ErrorCode.PARSE_ERROR);
  }
}

// Walk the string from `start` counting brace depth to find the end of the
// JSON object. Correctly handles strings containing braces and escape sequences.
function extractJsonObject(str: string, start: number): string {
  let depth = 0;
  let inString = false;
  let i = start;

  while (i < str.length) {
    const ch = str[i];

    if (inString) {
      if (ch === "\\") {
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i++;
      continue;
    }

    if (ch === '"') { inString = true; i++; continue; }
    if (ch === "{") { depth++; i++; continue; }
    if (ch === "}") {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
      i++;
      continue;
    }
    i++;
  }

  throw new YtMcpError(ErrorCode.PARSE_ERROR, "Unterminated JSON object in page");
}

// ---------------------------------------------------------------------------
// Caption track selection
// ---------------------------------------------------------------------------

export function getManualTracks(response: PlayerResponse): CaptionTrack[] {
  const tracks =
    response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  // YouTube marks auto-generated tracks with kind === "asr"
  return tracks.filter((t) => t.kind !== "asr");
}

export function getAsrTracks(response: PlayerResponse): CaptionTrack[] {
  const tracks =
    response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return tracks.filter((t) => t.kind === "asr");
}

export function getAllCaptionLanguages(response: PlayerResponse): string[] {
  const tracks =
    response.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];
  return [...new Set(tracks.map((t) => t.languageCode))];
}

// Selects the best track given an optional language preference.
// Priority: exact match → prefix match (e.g. "en" matches "en-US") → English → first available.
export function selectTrack(
  tracks: CaptionTrack[],
  language?: string | null
): CaptionTrack | null {
  if (tracks.length === 0) return null;

  if (language) {
    const exact = tracks.find((t) => t.languageCode === language);
    if (exact) return exact;

    const prefix = tracks.find((t) => t.languageCode.startsWith(language));
    if (prefix) return prefix;
  }

  const english =
    tracks.find((t) => t.languageCode === "en") ??
    tracks.find((t) => t.languageCode.startsWith("en-"));
  if (english) return english;

  return tracks[0];
}

// ---------------------------------------------------------------------------
// Caption text fetching
// ---------------------------------------------------------------------------

export async function fetchCaptionText(baseUrl: string): Promise<string> {
  const url = `${baseUrl}&fmt=json3`;

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { "User-Agent": PAGE_FETCH_HEADERS["User-Agent"] },
      signal: AbortSignal.timeout(CAPTION_FETCH_TIMEOUT_MS),
    });
  } catch (e) {
    logger.warn("captions: caption fetch failed", { error: String(e) });
    throw new YtMcpError(
      ErrorCode.PARSE_ERROR,
      `Caption fetch failed: ${String(e)}`
    );
  }

  if (!response.ok) {
    throw new YtMcpError(
      ErrorCode.PARSE_ERROR,
      `Caption endpoint returned HTTP ${response.status}`
    );
  }

  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json") || contentType.includes("text/plain")) {
    const data = (await response.json()) as { events?: unknown[] };
    return parseJson3Captions(data as Parameters<typeof parseJson3Captions>[0]);
  }

  // Some caption URLs return XML regardless of fmt param
  const text = await response.text();
  if (text.trimStart().startsWith("<")) {
    return parseXmlCaptions(text);
  }

  // Try JSON parse as last resort
  try {
    const data = JSON.parse(text);
    return parseJson3Captions(data);
  } catch {
    throw new YtMcpError(ErrorCode.PARSE_ERROR, "Unrecognized caption format");
  }
}
