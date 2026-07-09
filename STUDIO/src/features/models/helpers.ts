import { getProviderDisplayName } from "@/features/models/components/ProviderIcon";
import { formatPrice } from "@/utils/formatters";
import { isVisionModel } from "@/utils/modelUtils";
import type { Model } from "@/features/models/services/modelService";

export const CHAT_SELECTABLE_TYPES = new Set<Model["type"]>(["chat", "multimodal"]);
export const LONG_CONTEXT_TOKENS = 128_000;

export const TYPE_LABELS: Record<Model["type"], string> = {
  audio: "Audio",
  chat: "Chat",
  embedding: "Embed",
  image: "Image",
  multimodal: "Multimodal",
  tts: "TTS",
  video: "Video",
};

/** Compact context-window label for a known (non-optional) token count. */
export function formatContextWindow(tokens: number): string {
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

/** Compact context-window label that tolerates an undefined/zero count. */
export function formatCtx(tokens?: number): string {
  if (!tokens) return "Unknown";
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}

export function isFreeModel(model: Model): boolean {
  return Boolean(model.free || (model.pricing?.input === 0 && model.pricing?.output === 0));
}

export function hasTools(model: Model): boolean {
  return Boolean(model.supportsTools || model.capabilities?.includes("tool-calling"));
}

export function hasReasoning(model: Model): boolean {
  return Boolean(
    model.capabilities?.some((cap) => cap === "reasoning" || cap === "thinking") ||
    model.specialFeatures?.some((feature) => feature === "reasoning" || feature === "thinking")
  );
}

export function formatModelPrice(value?: number): string {
  if (value === undefined || value === null) return "N/A";
  return formatPrice(value);
}

export function getPriceSummary(model: Model): string {
  if (isFreeModel(model)) return "Free";
  if (!model.pricing) return "N/A";
  return `${formatModelPrice(model.pricing.input)} / ${formatModelPrice(model.pricing.output)}`;
}

export function getModelSubtitle(model: Model): string {
  const parts = [
    getProviderDisplayName(model.provider),
    TYPE_LABELS[model.type],
    model.architecture,
  ].filter(Boolean);
  return parts.join(" / ");
}

export function modelMatchesSearch(model: Model, search: string): boolean {
  if (!search.trim()) return true;
  const q = search.toLowerCase();
  return (
    model.name.toLowerCase().includes(q) ||
    model.id.toLowerCase().includes(q) ||
    model.provider.toLowerCase().includes(q) ||
    getProviderDisplayName(model.provider).toLowerCase().includes(q) ||
    Boolean(model.capabilities?.some((cap) => cap.toLowerCase().includes(q)))
  );
}

export { isVisionModel };
