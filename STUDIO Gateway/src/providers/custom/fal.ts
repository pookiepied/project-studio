/**
 * Fal custom — image/video generation not in models.dev.
 * Kept separate from SDK/openai path because Fal's primary endpoints
 * are not chat: /v1/... is only compatibility shim. Real paths are
 * `https://queue.fal.run/fal-ai/...` with async queue.
 *
 * For now: discovery lists known Fal models statically; chat stays
 * openai-compatible passthrough. When we add `POST /v1/images/generations`
 * gateway route, it will import this file directly.
 */

import type { ModelDefinition } from "../types.ts";

export const FAL_STATIC_MODELS: ModelDefinition[] = [
  { id: "fal-ai/flux-pro", providerId: "fal", displayName: "FLUX Pro", category: "image", inputModalities: ["text"], outputModalities: ["image"], contextWindow: null, maxOutputTokens: null, supportsTools: false, supportsParallelTools: false, supportsVision: false, supportsReasoning: false, reasoning: null, pricing: { input: 0.05, output: 0.05, cacheRead: null, cacheWrite: null }, releaseDate: null, raw: { source: "fal-static" } },
  { id: "fal-ai/flux-schnell", providerId: "fal", displayName: "FLUX Schnell", category: "image", inputModalities: ["text"], outputModalities: ["image"], contextWindow: null, maxOutputTokens: null, supportsTools: false, supportsParallelTools: false, supportsVision: false, supportsReasoning: false, reasoning: null, pricing: { input: 0.02, output: 0.02, cacheRead: null, cacheWrite: null }, releaseDate: null, raw: { source: "fal-static" } },
  { id: "fal-ai/kling-video", providerId: "fal", displayName: "Kling Video", category: "video", inputModalities: ["text", "image"], outputModalities: ["video"], contextWindow: null, maxOutputTokens: null, supportsTools: false, supportsParallelTools: false, supportsVision: true, supportsReasoning: false, reasoning: null, pricing: { input: 0.1, output: 0.1, cacheRead: null, cacheWrite: null }, releaseDate: null, raw: { source: "fal-static" } },
];
