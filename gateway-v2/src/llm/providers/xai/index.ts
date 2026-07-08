import type { ProviderModule } from "../../../core/registry";
import { xaiCapabilities } from "./capabilities";
import { xaiChat } from "./chat";
import { listXaiModels } from "./models";

// xAI (Grok, OpenAI-wire-compatible): chat (text + vision per model + tools + reasoning per
// model + streaming) only. The current Grok lineup is uniformly multimodal+tools, with
// reasoning on the -reasoning / grok-4.3 / multi-agent / grok-3-mini variants.
//
// No embed / transcribe / speak / image / video / audioGen / credits handlers — xAI does
// not expose those as normalized gateway capabilities for this provider (see
// ./capabilities.ts). Image generation was explicitly excluded from scope.
export const xaiProvider: ProviderModule = {
  id: "xai",
  capabilities: xaiCapabilities,
  models: listXaiModels,
  chat: xaiChat
};
