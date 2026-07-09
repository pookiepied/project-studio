/**
 * ProviderIcon — AI-provider badge for model surfaces.
 *
 * Routing layer: resolves provider slug → simple-icons path / monogram, then
 * delegates badge rendering to BrandLogo (the shared primitive). When
 * provider === "openrouter" and a modelId is passed, the badge reflects the
 * upstream provider (e.g. openrouter:openai/gpt-4 → OpenAI mark).
 *
 * Moves to features/models/ in Phase 4 (T4.5). BrandLogo stays in brand/.
 */

import {
  siAnthropic,
  siDeepseek,
  siGoogle,
  siMeta,
  siMistralai,
  siOllama,
  siOpenrouter,
  siPerplexity,
  siX,
} from "simple-icons";
import { BrandLogo } from '@/ui/brand/BrandLogo';
import type { BrandLogoSize } from '@/ui/brand/BrandLogo';

const SVG_MAP: Record<string, { path: string }> = {
  anthropic:  siAnthropic,
  deepseek:   siDeepseek,
  google:     siGoogle,
  local:      siOllama,
  meta:       siMeta,
  mistral:    siMistralai,
  ollama:     siOllama,
  openrouter: siOpenrouter,
  perplexity: siPerplexity,
  xai:        siX,
};

const MONOGRAM: Record<string, string> = {
  alibaba:          "Ali",
  azure:            "Az",
  bedrock:          "Br",
  cloudflare:       "Cf",
  cohere:           "Co",
  cerebras:         "Cb",
  fal:              "fal",
  fireworks:        "Fw",
  groq:             "Gq",
  minimax:          "Mx",
  openai:           "OA",
  together:         "Tg",
  "faster-whisper": "FW",
};

function getEffectiveProvider(provider: string, modelId?: string): string {
  const normalized = provider.toLowerCase();
  if (normalized === "openrouter" && modelId) {
    const colon = modelId.indexOf(":");
    if (colon > -1) {
      const after = modelId.slice(colon + 1);
      const slash = after.indexOf("/");
      if (slash > -1) {
        const upstream = after.slice(0, slash).toLowerCase();
        if (upstream && upstream !== "openrouter") return upstream;
      }
    }
  }
  return normalized;
}

export type ProviderIconSize = BrandLogoSize;

interface ProviderIconProps {
  provider: string;
  modelId?: string;
  size?: ProviderIconSize;
  className?: string;
}

export function ProviderIcon({
  provider,
  modelId,
  size = "sm",
  className = "",
}: ProviderIconProps) {
  const effective = getEffectiveProvider(provider, modelId);
  const svgData   = SVG_MAP[effective];
  const label     = getProviderDisplayName(effective);
  const monogram  = MONOGRAM[effective] ?? effective.slice(0, 2).toUpperCase();

  return (
    <BrandLogo
      path={svgData?.path}
      monogram={monogram}
      label={label}
      size={size}
      className={className}
    />
  );
}

export function getProviderDisplayName(provider: string): string {
  const map: Record<string, string> = {
    alibaba:          "Alibaba",
    anthropic:        "Anthropic",
    azure:            "Azure",
    bedrock:          "Bedrock",
    cloudflare:       "Cloudflare",
    cohere:           "Cohere",
    deepseek:         "DeepSeek",
    fal:              "fal.ai",
    fireworks:        "Fireworks",
    groq:             "Groq",
    google:           "Google",
    local:            "Local",
    meta:             "Meta",
    minimax:          "MiniMax",
    mistral:          "Mistral",
    ollama:           "Ollama",
    openai:           "OpenAI",
    openrouter:       "OpenRouter",
    perplexity:       "Perplexity",
    together:         "Together",
    xai:              "xAI",
    "faster-whisper": "Faster Whisper",
  };

  const normalized = provider.toLowerCase();
  return map[normalized] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
}
