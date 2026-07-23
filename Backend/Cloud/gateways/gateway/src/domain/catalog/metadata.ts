import type { ProviderId } from "@/domain/contracts";

export const CHECKED_AT = "2026-07-11";
export const VERSION = "2026-07-11.curated.1";
export const MANUAL_REGISTRY_VERSION = VERSION;
export const MANUAL_REGISTRY_GENERATED_AT = `${CHECKED_AT}T00:00:00.000Z`;
export const SOURCES: Record<ProviderId, string[]> = {
  openai: ["https://developers.openai.com/api/docs/models", "https://platform.openai.com/docs/pricing"],
  google: ["https://ai.google.dev/gemini-api/docs/gemini-3", "https://ai.google.dev/gemini-api/docs/pricing"],
  anthropic: [
    "https://platform.claude.com/docs/en/about-claude/models/overview",
    "https://platform.claude.com/docs/en/about-claude/pricing"
  ],
  groq: ["https://console.groq.com/docs/models"],
  xai: ["https://docs.x.ai/developers/models", "https://docs.x.ai/developers/pricing"],
  deepseek: ["https://api-docs.deepseek.com/quick_start/pricing/"],
  mistral: ["https://docs.mistral.ai/getting-started/models/models_overview/"],
  fal: ["https://fal.ai/docs/platform-apis/v1/models/pricing", "https://fal.ai/models"],
  replicate: ["https://replicate.com/pricing", "https://replicate.com/docs/topics/models/official-models"],
  elevenlabs: ["https://elevenlabs.io/docs/overview/models", "https://elevenlabs.io/pricing/api"],
  openrouter: [
    "https://openrouter.ai/api/v1/models",
    "https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties"
  ],
  alibaba: [
    "https://www.alibabacloud.com/help/en/model-studio/models",
    "https://www.alibabacloud.com/help/en/model-studio/model-pricing"
  ],
  minimax: ["https://platform.minimax.io/docs/guides/text-generation", "https://platform.minimax.io/docs/guides/pricing-paygo"],
  zai: ["https://docs.z.ai/guides/llm/glm-5.2", "https://docs.z.ai/guides/overview/pricing"],
  xiaomi: ["https://mimo.mi.com/docs/en-US/quick-start/summary/model", "https://mimo.mi.com/docs/price/pay-as-you-go"]
};
