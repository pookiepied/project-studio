export interface AudioFormat {
  mimeType: string;
  bitrate?: number;
  url?: string;
  signatureCipher?: string;
  approxDurationMs?: string;
  contentLength?: string;
}

// Returns the direct audio stream URL from a list of adaptive formats,
// or null if every audio format is protected by signature cipher (requires
// client-side JS decryption which cannot run in a Worker).
export function extractAudioUrl(formats: AudioFormat[]): string | null {
  const audioFormats = formats.filter(
    (f) => f.mimeType.startsWith("audio/") && f.url && !f.signatureCipher
  );

  if (audioFormats.length === 0) return null;

  // Prefer the lowest bitrate to minimise download time and stay under
  // the Groq Whisper 25 MB file size limit.
  const sorted = [...audioFormats].sort(
    (a, b) => (a.bitrate ?? 999_999) - (b.bitrate ?? 999_999)
  );

  return sorted[0].url ?? null;
}

export function hasAudioTrack(formats: AudioFormat[]): boolean {
  return formats.some((f) => f.mimeType.startsWith("audio/"));
}

export function getContentLengthBytes(formats: AudioFormat[]): number | null {
  const audioFormats = formats.filter(
    (f) => f.mimeType.startsWith("audio/") && f.url && !f.signatureCipher
  );
  if (audioFormats.length === 0) return null;

  const sorted = [...audioFormats].sort(
    (a, b) => (a.bitrate ?? 999_999) - (b.bitrate ?? 999_999)
  );

  const len = sorted[0].contentLength;
  return len ? parseInt(len, 10) : null;
}
