import type { ProviderStreams } from "@earendil-works/pi-ai";

/**
 * The wire protocols a user-declared provider can speak.
 *
 * Eight of Pi's ten language protocols load here. The two that cannot be
 * offered are named honestly rather than silently absent:
 *
 * - `bedrock-converse-stream` authenticates with an AWS access-key/secret
 *   pair signed per request (SigV4). A single API key field cannot carry it.
 * - `google-vertex` authenticates with a service-account credential exchanged
 *   for short-lived tokens. A single API key field cannot carry it.
 *
 * (`openai-codex-responses` and `pi-messages` remain unwired as well: the
 * first resolves only a ChatGPT OAuth credential, the second is Pi's own
 * service protocol, and neither accepts a user-typed key.)
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
  "mistral-conversations": () =>
    import("@earendil-works/pi-ai/api/mistral-conversations") as Promise<ProviderStreams>,
  "azure-openai-responses": () =>
    import("@earendil-works/pi-ai/api/azure-openai-responses") as Promise<ProviderStreams>,
};

export const DEFAULT_CUSTOM_API = "openai-completions";

export function supportedCustomApis(): readonly string[] {
  return Object.keys(API_LOADERS);
}
