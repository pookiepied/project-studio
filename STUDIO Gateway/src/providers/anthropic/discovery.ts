/**
 * Anthropic static fallback — legacy offline preview only.
 * Catalog sync (`models.dev`) is source of truth; live `GET /v1/models` overwrites this.
 * Keep minimal so admin preview works without credential; do not add fictional future models.
 */

import type { ModelDefinition } from "../types.ts";

// Deprecated: used only when no credential configured. Real data comes from catalog sync or live discovery.
export const ANTHROPIC_STATIC_MODELS: ModelDefinition[] = [
  {
    id: "claude-haiku-4-5",
    providerId: "anthropic",
    displayName: "Claude Haiku 4.5",
    category: "text",
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    contextWindow: 200_000,
    maxOutputTokens: 64_000,
    supportsTools: true,
    supportsParallelTools: true,
    supportsVision: true,
    supportsReasoning: true,
    reasoning: { type: "selected", levels: ["low", "medium", "high"] },
    pricing: { input: 1, output: 5, cacheRead: null, cacheWrite: null },
    releaseDate: "2025-10-01",
    raw: { source: "static-fallback" },
  },
  {
    id: "claude-sonnet-4-6",
    providerId: "anthropic",
    displayName: "Claude Sonnet 4.6",
    category: "text",
    inputModalities: ["text", "image"],
    outputModalities: ["text"],
    contextWindow: 1_000_000,
    maxOutputTokens: 128_000,
    supportsTools: true,
    supportsParallelTools: true,
    supportsVision: true,
    supportsReasoning: true,
    reasoning: { type: "dynamic", levels: ["low", "medium", "high"] },
    pricing: { input: 3, output: 15, cacheRead: null, cacheWrite: null },
    releaseDate: "2025-11-01",
    raw: { source: "static-fallback" },
  },
];
