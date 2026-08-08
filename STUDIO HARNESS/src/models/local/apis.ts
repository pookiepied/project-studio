import type { ProviderStreams } from "@earendil-works/pi-ai";

/**
 * Wire protocols a custom provider may declare.
 *
 * Anything OpenAI-shaped is the common case by a wide margin: Ollama, LM
 * Studio, vLLM, LiteLLM, and most proxy services all speak it, which is what
 * lets one configuration path cover providers Project Studio has never heard
 * of.
 *
 * This lives apart from the runtime so configuration validation can name the
 * supported protocols without importing the whole provider catalog.
 */
export const API_LOADERS: Record<string, () => Promise<ProviderStreams>> = {
  "openai-completions": () =>
    import("@earendil-works/pi-ai/api/openai-completions") as Promise<ProviderStreams>,
  "openai-responses": () =>
    import("@earendil-works/pi-ai/api/openai-responses") as Promise<ProviderStreams>,
  "anthropic-messages": () =>
    import("@earendil-works/pi-ai/api/anthropic-messages") as Promise<ProviderStreams>,
  "google-generative-ai": () =>
    import("@earendil-works/pi-ai/api/google-generative-ai") as Promise<ProviderStreams>,
};

export const DEFAULT_CUSTOM_API = "openai-completions";

export function supportedCustomApis(): readonly string[] {
  return Object.keys(API_LOADERS);
}
