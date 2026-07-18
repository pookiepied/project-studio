import type { ProviderModule } from "../../../core/registry";
import { groqCapabilities } from "./capabilities";
import { groqChat } from "./chat";
import { groqTranscription } from "./transcription";

// Groq (OpenAI-wire-compatible): chat + STT (Whisper). No embed/image/video/credits handlers —
// the provider is scoped to chat + transcription here (see ./capabilities.ts).
export const groqProvider: ProviderModule = {
  id: "groq",
  capabilities: groqCapabilities,
  chat: groqChat,
  transcribe: groqTranscription
};
