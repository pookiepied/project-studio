import type { ProviderModule } from "../../../core/registry";
import { falCapabilities } from "./capabilities";
import { falImage } from "./images";
import { falSpeech } from "./speech";
import { falTranscription } from "./transcription";
import { falVideo } from "./video";
import { listFalModels } from "./models";

// Fal AI (media provider, no chat): image generation + editing, video generation, speech
// (TTS) and transcription (STT), all via the official @ai-sdk/fal package over CF AI Gateway.
export const falProvider: ProviderModule = {
  id: "fal",
  capabilities: falCapabilities,
  models: listFalModels,
  image: falImage,
  video: falVideo,
  speak: falSpeech,
  transcribe: falTranscription
};
