import type { ProviderModule } from "@/providers/types";
import { falCapabilities } from "./capabilities";
import { falImage } from "./images";
import { falVideo } from "./video";

// Fal AI (media provider, no chat): image generation + editing and video generation, via the
// official @ai-sdk/fal package over CF AI Gateway. (Fal also has TTS/STT models, but audio is
// served through OpenAI/ElevenLabs/Groq here, so Fal is scoped to image + video.)
export const falProvider: ProviderModule = {
  id: "fal",
  capabilities: falCapabilities,
  image: falImage,
  video: falVideo
};
