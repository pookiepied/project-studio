import { TOOL_PICTURE_MAX_BYTES } from "../../contracts/media-limits.js";

/**
 * Whether one picture a tool is about to return is small enough to send.
 *
 * Only the single picture is judged here. What a whole request may carry -
 * how many pictures, how many bytes, which sizes - is decided once per
 * request in `gateway/language/image-window.ts`, which sees every picture the
 * history holds, from every source. A per-conversation count used to live
 * here too; it refused `read` of an old picture after twenty, which is
 * exactly how the window tells the model to get a dropped picture back.
 *
 * The answer is what to tell the model, or null when the picture fits.
 */
export function pictureSizeRefusal(path: string, bytes: number): string | null {
  if (bytes <= TOOL_PICTURE_MAX_BYTES) return null;
  return (
    `${path} is ${String(Math.round(bytes / 1024))} KB, and the limit for one picture is ` +
    `${String(Math.round(TOOL_PICTURE_MAX_BYTES / 1024))} KB. Resize it, or ask the user to.`
  );
}
