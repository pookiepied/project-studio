import type { ProviderModule } from "../../../core/registry";
import { alibabaCapabilities } from "./capabilities";
import { alibabaChat } from "./chat";
import { listAlibabaModels } from "./models";

// Alibaba Model Studio (Qwen + more) via Cloudflare AI Gateway CUSTOM provider (slug
// `custom-alibaba`) + the official @ai-sdk/openai-compatible package. Scope: text + multimodal
// (vision) chat only (see ./capabilities.ts). This was the template for the other OpenAI-
// compatible custom providers (see ../minimax, ../zai, ../xiaomi).
export const alibabaProvider: ProviderModule = {
  id: "alibaba",
  capabilities: alibabaCapabilities,
  models: listAlibabaModels,
  chat: alibabaChat
};
