/** Container names for JSON audio fields and multipart filenames. */
export function audioFormat(mimeType: string): string {
  const subtype = mimeType.toLowerCase().split(";")[0]?.split("/")[1] ?? "";
  const known: Readonly<Record<string, string>> = {
    mpeg: "mp3", mp3: "mp3", wav: "wav", "x-wav": "wav", wave: "wav",
    webm: "webm", ogg: "ogg", flac: "flac", mp4: "m4a", "x-m4a": "m4a", m4a: "m4a", aac: "aac",
  };
  return known[subtype] ?? subtype.replace(/[^a-zA-Z0-9+._-]/g, "");
}
