import type { ProviderModule } from "../../../core/registry";
import { falCapabilities } from "./capabilities";
import { falImage } from "./images";
import { falVideo } from "./video";

// Fal AI (media provider, no chat): image generation + editing, video generation, speech
// (TTS) and transcription (STT), all via the official @ai-sdk/fal package over CF AI Gateway.
export const falProvider: ProviderModule = {
  id: "fal",
  capabilities: falCapabilities,
  image: falImage,
  video: falVideo
};
