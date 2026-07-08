import type { ProviderModule } from "../../../core/registry";
import { groqCapabilities } from "./capabilities";
import { groqChat } from "./chat";
import { listGroqModels } from "./models";
import { groqSpeech } from "./speech";
import { groqTranscription } from "./transcription";

// Groq (OpenAI-wire-compatible): chat + STT (Whisper) + TTS (Orpheus). No embed/rerank/
// image/video/credits handlers — the provider does not support those (see ./capabilities.ts).
export const groqProvider: ProviderModule = {
  id: "groq",
  capabilities: groqCapabilities,
  models: listGroqModels,
  chat: groqChat,
  transcribe: groqTranscription,
  speak: groqSpeech
};
