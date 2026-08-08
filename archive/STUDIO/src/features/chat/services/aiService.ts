/**
 * aiService — backward-compat facade.
 *
 * Its only remaining purpose is the `aiService` object below, for callers that
 * still write aiService.xxx(). It re-exports nothing: every caller reaches the
 * implementation modules through that object, and types come from @/types/chat.
 *
 * Implementation lives in focused modules — import from them directly:
 *   types.ts                    — APIChatMessage, LocalToolCall, etc.
 *   chatService.ts              — Non-streaming chat, rephrase, vision
 *   mediaService.ts             — Transcription, TTS
 *   daemonService.ts            — Local Ollama streaming
 *   ../inputs/image/            — Image compression and vision utilities
 *
 * Streaming chat is handled by useAgentChat (WebSocket, see src/hooks/).
 */

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
