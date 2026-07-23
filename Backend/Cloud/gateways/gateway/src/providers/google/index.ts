import type { ProviderModule } from "@/providers/types";
import { googleCapabilities } from "./capabilities";
import { googleChat } from "./chat";
import { googleEmbeddings } from "./embeddings";
import { googleImage } from "./images";

export const googleProvider: ProviderModule = {
  id: "google",
  capabilities: googleCapabilities,
  chat: googleChat,
  embed: googleEmbeddings,
  image: googleImage
};
