import type { ProviderModule } from "@/providers/types";
import { replicateCapabilities } from "./capabilities";
import { replicateImage } from "./images";
import { replicateVideo } from "./video";

// Replicate (media provider, no chat): image generation + editing and video generation, via
// the official @ai-sdk/replicate package over CF AI Gateway.
export const replicateProvider: ProviderModule = {
  id: "replicate",
  capabilities: replicateCapabilities,
  image: replicateImage,
  video: replicateVideo
};
