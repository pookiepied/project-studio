import type { ProviderModule } from "../../../core/registry";
import { openaiCapabilities } from "./capabilities";
import { openaiChat } from "./chat";
import { openaiEmbeddings } from "./embeddings";
import { openaiImage } from "./images";
import { openaiSpeech } from "./speech";
import { openaiTranscription } from "./transcription";

export const openaiProvider: ProviderModule = {
  id: "openai",
  capabilities: openaiCapabilities,
  chat: openaiChat,
  embed: openaiEmbeddings,
  transcribe: openaiTranscription,
  speak: openaiSpeech,
  image: openaiImage
};
