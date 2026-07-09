/**
 * Model Filter — single source of truth for model filtering in the frontend.
 *
 * The backend fetches and returns ALL models from ALL providers. This module
 * decides what to SHOW in each UI context. Change a preset → behavior changes
 * everywhere that preset is used. Nothing is hardcoded inline.
 *
 * ── Usage ────────────────────────────────────────────────────────────────────
 *
 *   import { filterModels, MODEL_FILTERS } from "@/features/models/services/modelFilter";
 *
 *   // Filter to chat-capable models only
 *   const chatModels = filterModels(allModels, MODEL_FILTERS.CHAT);
 *
 *   // Filter to vision models (can see images + chat)
 *   const visionModels = filterModels(allModels, MODEL_FILTERS.VISION);
 *
 *   // Compose custom filters on the fly
 *   const freeVisionModels = filterModels(allModels, {
 *     ...MODEL_FILTERS.VISION,
 *     freeOnly: true,
 *   });
 *
 * ── Adding a new preset ───────────────────────────────────────────────────────
 *   1. Add an entry to MODEL_FILTERS below.
 *   2. Use it in your component — no other changes needed.
 *
 * ── Adding a new filter field ────────────────────────────────────────────────
 *   1. Add the field to ModelFilter below (optional, all fields are opt-in).
 *   2. Add a corresponding check in filterModels().
 *   3. TypeScript will surface any call sites that need updating.
 */

import type { Model } from "./modelService";

// ─────────────────────────────────────────────────────────────────────────────
// ModelFilter — composable filter specification
//
// Every field is optional. Omit a field → that dimension is unconstrained.
// Multiple fields are combined with AND logic.
// ─────────────────────────────────────────────────────────────────────────────

export interface ModelFilter {
  /**
   * Include only models whose `type` is in this list.
   * Examples: ["chat", "multimodal"], ["image"], ["video"]
   */
  types?: Model["type"][];

  /**
   * Include only models that have ALL of these capability strings.
   * Checked against model.capabilities[].
   */
  requireCapabilities?: string[];

  /**
   * Include only models that have AT LEAST ONE of these capability strings.
   */
  anyCapabilities?: string[];

  /**
   * Include only models where supportsTools matches this value.
   * Useful for "only show tool-calling capable models".
   */
  supportsTools?: boolean;

  /**
   * Include only models where supportsVision matches this value.
   */
  supportsVision?: boolean;

  /**
   * Include only models where supportsStreaming matches this value.
   */
  supportsStreaming?: boolean;

  /**
   * Include only models where supportsSystemPrompts matches this value.
   */
  supportsSystemPrompts?: boolean;

  /**
   * Include only models from these providers (whitelist).
   * Example: ["anthropic", "openai"]
   */
  providers?: string[];

  /**
   * Exclude models from these providers (blacklist).
   * Applied after `providers` whitelist.
   */
  excludeProviders?: string[];

  /**
   * Include only free models (model.free === true).
   */
  freeOnly?: boolean;

  /**
   * Include only models whose input price per 1M tokens is ≤ this value.
   */
  maxInputPricePer1M?: number;

  /**
   * Include only models whose context window is ≥ this value (tokens).
   */
  minContextWindow?: number;

  /**
   * Text search across model name and provider (case-insensitive).
   * Typically applied on top of a base filter by the component, not stored
   * in a preset.
   */
  search?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// filterModels — apply a ModelFilter to an array of Model objects
// ─────────────────────────────────────────────────────────────────────────────

export function filterModels(models: Model[], filter: ModelFilter): Model[] {
  return models.filter(model => {
    // ── Type ─────────────────────────────────────────────────────────────────
    if (filter.types?.length && !filter.types.includes(model.type)) {
      return false;
    }

    // ── Capability — all required ─────────────────────────────────────────────
    if (filter.requireCapabilities?.length) {
      const caps = model.capabilities ?? [];
      if (!filter.requireCapabilities.every(c => caps.includes(c))) return false;
    }

    // ── Capability — at least one ─────────────────────────────────────────────
    if (filter.anyCapabilities?.length) {
      const caps = model.capabilities ?? [];
      if (!filter.anyCapabilities.some(c => caps.includes(c))) return false;
    }

    // ── Boolean feature flags ────────────────────────────────────────────────
    if (filter.supportsTools !== undefined && model.supportsTools !== filter.supportsTools) {
      return false;
    }
    if (filter.supportsVision !== undefined && model.supportsVision !== filter.supportsVision) {
      return false;
    }
    if (filter.supportsStreaming !== undefined && model.supportsStreaming !== filter.supportsStreaming) {
      return false;
    }
    if (filter.supportsSystemPrompts !== undefined && model.supportsSystemPrompts !== filter.supportsSystemPrompts) {
      return false;
    }

    // ── Provider whitelist / blacklist ────────────────────────────────────────
    if (filter.providers?.length && !filter.providers.includes(model.provider)) {
      return false;
    }
    if (filter.excludeProviders?.length && filter.excludeProviders.includes(model.provider)) {
      return false;
    }

    // ── Price ─────────────────────────────────────────────────────────────────
    if (filter.freeOnly && !model.free) {
      return false;
    }
    if (
      filter.maxInputPricePer1M !== undefined &&
      (model.pricing?.input ?? 0) > filter.maxInputPricePer1M
    ) {
      return false;
    }

    // ── Context window ────────────────────────────────────────────────────────
    if (
      filter.minContextWindow !== undefined &&
      (model.contextWindow ?? 0) < filter.minContextWindow
    ) {
      return false;
    }

    // ── Text search ───────────────────────────────────────────────────────────
    if (filter.search?.trim()) {
      const q = filter.search.toLowerCase();
      const nameMatch     = model.name.toLowerCase().includes(q);
      const providerMatch = model.provider.toLowerCase().includes(q);
      if (!nameMatch && !providerMatch) return false;
    }

    return true;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL_FILTERS — named presets for every UI context
//
// These are the only place where "what shows in the chat picker" or "what shows
// in the image picker" is decided. No component should hardcode type logic.
//
// Each preset is a plain ModelFilter object — composable and overridable.
// ─────────────────────────────────────────────────────────────────────────────

export const MODEL_FILTERS = {
  /**
   * Main chat model picker — all text-capable models.
   * Includes multimodal (vision) models since they can also chat.
   */
  CHAT: {
    types: ["chat", "multimodal"],
  } satisfies ModelFilter,

  /**
   * Chat models that explicitly support vision (can see uploaded images).
   * Subset of CHAT.
   */
  VISION: {
    types: ["chat", "multimodal"],
    supportsVision: true,
  } satisfies ModelFilter,

  /**
   * Chat models that explicitly support tool/function calling.
   * Subset of CHAT. Useful for agentic contexts.
   */
  TOOL_CALLING: {
    types: ["chat", "multimodal"],
    supportsTools: true,
  } satisfies ModelFilter,

  /**
   * Chat models with reasoning / chain-of-thought capability.
   * Examples: o1, o3, DeepSeek R1, QwQ, Claude extended thinking.
   */
  REASONING: {
    types: ["chat", "multimodal"],
    anyCapabilities: ["reasoning", "thinking"],
  } satisfies ModelFilter,

  /**
   * Image generation model picker (Settings → Image Generation Model).
   * Includes both fal.ai and any OpenRouter image models.
   */
  IMAGE: {
    types: ["image"],
  } satisfies ModelFilter,

  /**
   * Video generation model picker (Settings → Video Generation Model).
   */
  VIDEO: {
    types: ["video"],
  } satisfies ModelFilter,

  /**
   * Audio transcription / speech-to-text model picker.
   */
  AUDIO_IN: {
    types: ["audio"],
  } satisfies ModelFilter,

  /**
   * Text-to-speech model picker.
   */
  AUDIO_OUT: {
    types: ["tts"],
  } satisfies ModelFilter,

  /**
   * Embedding model picker (used by RAG tooling).
   */
  EMBEDDING: {
    types: ["embedding"],
  } satisfies ModelFilter,

  /**
   * Free models only — chat / multimodal.
   * Useful for a "free tier" filter toggle in the UI.
   */
  FREE_CHAT: {
    types: ["chat", "multimodal"],
    freeOnly: true,
  } satisfies ModelFilter,

  /**
   * Long-context chat models (≥ 128K tokens).
   * Useful for document analysis contexts.
   */
  LONG_CONTEXT: {
    types: ["chat", "multimodal"],
    minContextWindow: 128_000,
  } satisfies ModelFilter,
} as const;

/**
 * Type-safe union of MODEL_FILTERS keys.
 * Use this when accepting a preset name as a prop.
 *
 * Example:
 *   interface Props { preset: ModelFilterPreset }
 *   <ModelPicker preset="CHAT" />
 */
export type ModelFilterPreset = keyof typeof MODEL_FILTERS;
