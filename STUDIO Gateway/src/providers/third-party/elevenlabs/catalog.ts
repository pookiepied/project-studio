/**
 * ElevenLabs static catalog — canonical location (was `providers/custom/elevenlabs.ts`).
 * Transports are in `index.ts` via AI SDK; this file is catalog-only.
 */

import type { ModelDefinition } from "../../types.ts";

export const ELEVENLABS_STATIC_MODELS: ModelDefinition[] = [
  { id: "eleven_multilingual_v2", providerId: "elevenlabs", displayName: "Multilingual v2", category: "speech", inputModalities: ["text"], outputModalities: ["audio"], contextWindow: null, maxOutputTokens: null, supportsTools: false, supportsParallelTools: false, supportsVision: false, supportsReasoning: false, reasoning: null, pricing: { input: 0.18, output: 0.18, cacheRead: null, cacheWrite: null }, releaseDate: null, raw: { source: "elevenlabs-static" } },
  { id: "eleven_turbo_v2_5", providerId: "elevenlabs", displayName: "Turbo v2.5", category: "speech", inputModalities: ["text"], outputModalities: ["audio"], contextWindow: null, maxOutputTokens: null, supportsTools: false, supportsParallelTools: false, supportsVision: false, supportsReasoning: false, reasoning: null, pricing: { input: 0.18, output: 0.18, cacheRead: null, cacheWrite: null }, releaseDate: null, raw: { source: "elevenlabs-static" } },
  { id: "scribe_v1", providerId: "elevenlabs", displayName: "Scribe v1", category: "transcription", inputModalities: ["audio"], outputModalities: ["text"], contextWindow: null, maxOutputTokens: null, supportsTools: false, supportsParallelTools: false, supportsVision: false, supportsReasoning: false, reasoning: null, pricing: { input: 0.04, output: null, cacheRead: null, cacheWrite: null }, releaseDate: null, raw: { source: "elevenlabs-static" } },
];
