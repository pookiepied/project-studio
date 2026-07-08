import type { ProviderModule } from "../../../core/registry";
import { replicateCapabilities } from "./capabilities";
import { replicateImage } from "./images";
import { replicateVideo } from "./video";
import { listReplicateModels } from "./models";

// Replicate (media provider, no chat): image generation + editing and video generation, via
// the official @ai-sdk/replicate package over CF AI Gateway.
export const replicateProvider: ProviderModule = {
  id: "replicate",
  capabilities: replicateCapabilities,
  models: listReplicateModels,
  image: replicateImage,
  video: replicateVideo
};
