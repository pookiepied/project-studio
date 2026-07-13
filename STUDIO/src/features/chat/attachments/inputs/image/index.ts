/**
 * Studio client-side image utilities.
 *
 * Single import point for image compression and base64 helpers used by
 * chat request assembly.
 */

export {
  arrayBufferToBase64,
  compressLargeImageForProvider,
  compressImageForMultiAttachment,
  pickImageDetail,
} from "./imageUtils";
