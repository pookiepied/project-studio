const PROVIDER_SLUGS: Record<string, string> = {
  openai: "openai",
  google: "google-ai-studio",
  anthropic: "anthropic",
  groq: "groq",
  xai: "grok",
  deepseek: "deepseek",
  mistral: "mistral",
  fal: "fal",
  replicate: "replicate",
  elevenlabs: "elevenlabs",
  openrouter: "openrouter",
  alibaba: "custom-alibaba",
  minimax: "custom-minimax",
  zai: "custom-zai",
  xiaomi: "custom-xiaomi"
};

const PROVIDER_API_BASE_PATHS: Record<string, string> = {
  google: "/v1beta",
  anthropic: "/v1",
  mistral: "/v1"
};

export interface CloudflareProviderRoute {
  slug: string;
  basePath: string;
  mode: "native" | "custom";
}

export function getCloudflareProviderRoute(provider: string): CloudflareProviderRoute {
  const slug = PROVIDER_SLUGS[provider] ?? provider;
  return {
    slug,
    basePath: PROVIDER_API_BASE_PATHS[provider] ?? "",
    mode: slug.startsWith("custom-") ? "custom" : "native"
  };
}
