/**
 * aiService — backward-compat facade.
 *
 * All implementation has been split into focused modules:
 *   types.ts                    — APIChatMessage, LocalToolCall, etc.
 *   chatService.ts              — Non-streaming chat, rephrase, vision
 *   mediaService.ts             — Transcription, TTS
 *   daemonService.ts            — Local Ollama streaming
 *   ../inputs/image/            — Image compression and vision utilities
 *
 * Streaming chat is handled by useAgentChat (WebSocket, see src/hooks/).
 * Import from the specific module when adding new features.
 * For image utilities, import from: services/inputs/image
 */

export * from "./types";
export * from "./daemonService";

export {
  chat,
  rephrase,
  chatWithImages,
  augmentMessagesWithImages,
  augmentMessagesWithPDFImages,
} from "./chatService";

export { transcribe, tts, saveAudioToTemp } from "./mediaService";
export { chatStream } from "./sseStream";

// ---------------------------------------------------------------------------
// Convenience object for callers that still use aiService.xxx()
// ---------------------------------------------------------------------------

import { chat, rephrase, chatWithImages, augmentMessagesWithImages, augmentMessagesWithPDFImages } from "./chatService";
import { transcribe, tts, saveAudioToTemp } from "./mediaService";
import { chatStream } from "./sseStream";

export const aiService = {
  chat,
  rephrase,
  chatWithImages,
  augmentMessagesWithImages,
  augmentMessagesWithPDFImages,
  transcribe,
  tts,
  saveAudioToTemp,
  /** @deprecated Use useAgentChat (WebSocket) for chat streaming. Kept for useLiveSession. */
  chatStream,
};
