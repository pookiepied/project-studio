/**
 * Provider capability registry.
 *
 * Single source of truth for:
 *   - what each provider supports (modalities)
 *   - which modalities are enabled in Studio by default
 *
 * Runtime overrides via PROVIDER_MODALITIES_CONFIG env var (JSON):
 *   { "minimax": { "text": true }, "openrouter": { "rerank": true } }
 */

export type ProviderModality = "text" | "embedding" | "image" | "video" | "tts" | "stt" | "rerank";

export interface ProviderConfig {
  /** All modalities this provider is capable of */
  supports: ProviderModality[];
  /** Modalities enabled in Studio by default */
  enabledByDefault: ProviderModality[];
}

const REGISTRY: Record<string, ProviderConfig> = {
  openai: {
    supports:         ["text", "embedding", "image", "tts", "stt"],
    enabledByDefault: ["text", "embedding", "tts", "stt"],
  },
  anthropic: {
    supports:         ["text"],
    enabledByDefault: ["text"],
  },
  google: {
    supports:         ["text", "embedding", "image", "tts"],
    enabledByDefault: ["text", "tts"],
  },
  groq: {
    supports:         ["text", "stt", "tts"],
    enabledByDefault: ["text", "stt", "tts"],
  },
  xai: {
    supports:         ["text", "image", "video"],
    enabledByDefault: ["text"],
  },
  deepseek: {
    supports:         ["text"],
    enabledByDefault: ["text"],
  },
  mistral: {
    supports:         ["text", "embedding"],
    enabledByDefault: ["text", "embedding"],
  },
  cohere: {
    supports:         ["text", "embedding", "rerank"],
    enabledByDefault: ["text", "embedding", "rerank"],
  },
  bedrock: {
    supports:         ["text", "embedding", "image"],
    enabledByDefault: ["text", "embedding"],
  },
  azure: {
    supports:         ["text", "embedding", "image", "tts", "stt"],
    enabledByDefault: ["text", "embedding"],
  },
  openrouter: {
    supports:         ["text", "image", "video", "tts", "stt", "embedding", "rerank"],
    enabledByDefault: ["text", "image", "video"],
  },
  alibaba: {
    supports:         ["text", "tts"],
    enabledByDefault: ["text"],
  },
  minimax: {
    // text intentionally OFF by default; TTS is the primary use case
    supports:         ["text", "tts", "stt"],
    enabledByDefault: ["tts"],
  },
  ollama: {
    supports:         ["text", "embedding"],
    enabledByDefault: ["text", "embedding"],
  },
  lmstudio: {
    supports:         ["text"],
    enabledByDefault: ["text"],
  },
  fal: {
    supports:         ["image", "video"],
    enabledByDefault: ["image", "video"],
  },
};

export function getProviderConfig(provider: string): ProviderConfig | undefined {
  return REGISTRY[provider];
}

/**
 * Returns the effective set of enabled modalities for a provider.
 * Applies PROVIDER_MODALITIES_CONFIG overrides on top of enabledByDefault.
 */
export function getEnabledModalities(
  provider: string,
  modalitiesConfigJson: string | undefined,
): ProviderModality[] {
  const config = REGISTRY[provider];
  if (!config) return [];

  const effective = new Set<ProviderModality>(config.enabledByDefault);

  if (modalitiesConfigJson) {
    try {
      const overrides = JSON.parse(modalitiesConfigJson) as Record<string, Record<string, boolean>>;
      const providerOverrides = overrides[provider];
      if (providerOverrides) {
        for (const [modality, enabled] of Object.entries(providerOverrides)) {
          if (!config.supports.includes(modality as ProviderModality)) continue;
          if (enabled) {
            effective.add(modality as ProviderModality);
          } else {
            effective.delete(modality as ProviderModality);
          }
        }
      }
    } catch {
      // ignore malformed config — fall back to defaults
    }
  }

  return Array.from(effective);
}

/** Whether a specific modality is enabled for a provider. */
export function isModalitySupported(provider: string, modality: ProviderModality): boolean {
  return REGISTRY[provider]?.supports.includes(modality) ?? false;
}
