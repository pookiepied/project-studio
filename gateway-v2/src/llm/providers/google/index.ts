import type { ProviderModule } from "../../../core/registry";
import { googleCapabilities } from "./capabilities";
import { googleChat } from "./chat";
import { googleEmbeddings } from "./embeddings";
import { googleImage } from "./images";
import { listGoogleModels } from "./models";

export const googleProvider: ProviderModule = {
  id: "google",
  capabilities: googleCapabilities,
  models: listGoogleModels,
  chat: googleChat,
  embed: googleEmbeddings,
  image: googleImage
};
