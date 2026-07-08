import type { ModelInfo } from "../../../../core/capabilities";
import {
  createOpenAIChatModel,
  createOpenAIEmbeddingModel,
  createOpenAIImageModel,
  createOpenAISpeechModel,
  createOpenAITranscriptionModel
} from "./metadata";
import { getReasoningForOpenAIModel } from "./reasoning";

export const OPENAI_SEED_MODELS: ModelInfo[] = [
  createOpenAIChatModel("gpt-5.5"),
  createOpenAIChatModel("gpt-5.5-pro"),
  createOpenAIChatModel("gpt-5.4"),
  createOpenAIChatModel("gpt-5.4-pro"),
  createOpenAIChatModel("gpt-5.4-mini"),
  createOpenAIChatModel("gpt-5.4-nano"),
  createOpenAIChatModel("gpt-5"),
  createOpenAIChatModel("gpt-5-mini"),
  createOpenAIChatModel("gpt-5-nano"),
  createOpenAIChatModel("gpt-4.1"),
  createOpenAIChatModel("gpt-4.1-mini"),
  createOpenAIChatModel("gpt-4o"),
  createOpenAIChatModel("gpt-4o-mini"),
  createOpenAIChatModel("gpt-4o-mini-search-preview", {
    vision: false,
    tools: false,
    jsonSchema: false,
    reasoning: getReasoningForOpenAIModel("gpt-4o-mini-search-preview")
  }),
  createOpenAIChatModel("gpt-3.5-turbo", { vision: false }),
  createOpenAIEmbeddingModel("text-embedding-3-small"),
  createOpenAIEmbeddingModel("text-embedding-3-large"),
  createOpenAIEmbeddingModel("text-embedding-ada-002"),
  createOpenAITranscriptionModel("whisper-1"),
  createOpenAITranscriptionModel("gpt-4o-mini-transcribe"),
  createOpenAITranscriptionModel("gpt-4o-transcribe"),
  createOpenAISpeechModel("tts-1"),
  createOpenAISpeechModel("tts-1-hd"),
  createOpenAISpeechModel("gpt-4o-mini-tts"),
  createOpenAIImageModel("gpt-image-1", true),
  createOpenAIImageModel("gpt-image-2", true)
];
