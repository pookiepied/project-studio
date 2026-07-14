/**
 * Anthropic Provider Discovery
 *
 * Anthropic has no public /models endpoint, so the model list is maintained
 * statically here. Update when Anthropic releases new models.
 *
 * Notes:
 *  - All Claude models are accessed via the OpenAI-compatibility beta endpoint
 *    (https://api.anthropic.com/v1 with `anthropic-version` header).
 *  - Extended-thinking models support a `<think>` block — BaseAdapter strips
 *    these before sending history back to the model.
 *  - Tool use: all Claude 3+ models support function calling.
 *  - Vision: all Claude 3+ models accept image inputs.
 *
 * Pricing: USD per 1 000 000 tokens (as of May 2026)
 *   https://www.anthropic.com/pricing
 */

import { ProviderDiscovery } from "../base";
import { Model } from "../../types";
import { logger } from "../../logger";

// ─────────────────────────────────────────────────────────────────────────────
// Static model catalogue
// ─────────────────────────────────────────────────────────────────────────────

const ANTHROPIC_MODELS: Model[] = [
  // ── Claude 4 ─────────────────────────────────────────────────────────────
  {
    id: "anthropic:claude-opus-4-5",
    provider: "anthropic",
    type: "multimodal",
    name: "Claude Opus 4.5",
    description: "Most capable Claude model — frontier intelligence for complex, open-ended tasks",
    maxTokens: 32000,
    contextWindow: 200000,
    pricing: { input: 15, output: 75, currency: "USD" },
    free: false,
    capabilities: ["chat", "vision", "multimodal", "reasoning", "code", "tool-calling"],
    modality: ["text", "image"],
    architecture: "Claude",
    supportsVision: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: ["text", "image"],
    outputTypes: ["text"],
    specialFeatures: ["reasoning", "code"],
  },
  {
    id: "anthropic:claude-sonnet-4-5",
    provider: "anthropic",
    type: "multimodal",
    name: "Claude Sonnet 4.5",
    description: "Best balance of intelligence and speed — ideal for agentic coding and complex workflows",
    maxTokens: 16000,
    contextWindow: 200000,
    pricing: { input: 3, output: 15, currency: "USD" },
    free: false,
    capabilities: ["chat", "vision", "multimodal", "reasoning", "code", "tool-calling"],
    modality: ["text", "image"],
    architecture: "Claude",
    supportsVision: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: ["text", "image"],
    outputTypes: ["text"],
    specialFeatures: ["reasoning", "code"],
  },
  {
    id: "anthropic:claude-haiku-4-5",
    provider: "anthropic",
    type: "multimodal",
    name: "Claude Haiku 4.5",
    description: "Fastest and most compact Claude 4 model — low-latency tasks and high-volume pipelines",
    maxTokens: 8192,
    contextWindow: 200000,
    pricing: { input: 0.8, output: 4, currency: "USD" },
    free: false,
    capabilities: ["chat", "vision", "multimodal", "tool-calling", "fast-inference"],
    modality: ["text", "image"],
    architecture: "Claude",
    supportsVision: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: ["text", "image"],
    outputTypes: ["text"],
  },
  // ── Claude 3.7 ───────────────────────────────────────────────────────────
  {
    id: "anthropic:claude-3-7-sonnet-20250219",
    provider: "anthropic",
    type: "multimodal",
    name: "Claude 3.7 Sonnet",
    description: "Hybrid reasoning model — supports extended thinking for step-by-step problem solving",
    maxTokens: 16000,
    contextWindow: 200000,
    pricing: { input: 3, output: 15, currency: "USD" },
    free: false,
    capabilities: ["chat", "vision", "multimodal", "reasoning", "thinking", "code", "tool-calling"],
    modality: ["text", "image"],
    architecture: "Claude",
    supportsVision: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: ["text", "image"],
    outputTypes: ["text"],
    specialFeatures: ["thinking", "reasoning", "code"],
  },
  // ── Claude 3.5 ───────────────────────────────────────────────────────────
  {
    id: "anthropic:claude-3-5-sonnet-20241022",
    provider: "anthropic",
    type: "multimodal",
    name: "Claude 3.5 Sonnet",
    description: "Previous-generation Sonnet — strong coding and instruction following",
    maxTokens: 8192,
    contextWindow: 200000,
    pricing: { input: 3, output: 15, currency: "USD" },
    free: false,
    capabilities: ["chat", "vision", "multimodal", "code", "tool-calling"],
    modality: ["text", "image"],
    architecture: "Claude",
    supportsVision: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: ["text", "image"],
    outputTypes: ["text"],
    specialFeatures: ["code"],
  },
  {
    id: "anthropic:claude-3-5-haiku-20241022",
    provider: "anthropic",
    type: "multimodal",
    name: "Claude 3.5 Haiku",
    description: "Previous-generation compact Claude — fast, affordable, vision-capable",
    maxTokens: 8192,
    contextWindow: 200000,
    pricing: { input: 0.8, output: 4, currency: "USD" },
    free: false,
    capabilities: ["chat", "vision", "multimodal", "tool-calling", "fast-inference"],
    modality: ["text", "image"],
    architecture: "Claude",
    supportsVision: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: ["text", "image"],
    outputTypes: ["text"],
  },
  // ── Claude 3 ─────────────────────────────────────────────────────────────
  {
    id: "anthropic:claude-3-opus-20240229",
    provider: "anthropic",
    type: "multimodal",
    name: "Claude 3 Opus",
    description: "Previous flagship — excellent at writing, analysis, and nuanced reasoning",
    maxTokens: 4096,
    contextWindow: 200000,
    pricing: { input: 15, output: 75, currency: "USD" },
    free: false,
    capabilities: ["chat", "vision", "multimodal", "reasoning", "creative", "tool-calling"],
    modality: ["text", "image"],
    architecture: "Claude",
    supportsVision: true,
    supportsTools: true,
    supportsParallelTools: true,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: ["text", "image"],
    outputTypes: ["text"],
    specialFeatures: ["reasoning", "creative"],
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Discovery class
// ─────────────────────────────────────────────────────────────────────────────

export class AnthropicDiscovery implements ProviderDiscovery {
  name = "anthropic";

  constructor(private readonly apiKey: string) {}

  async discoverModels(): Promise<Model[]> {
    if (!this.apiKey) return [];
    // Anthropic has no public /models endpoint (confirmed as of May 2026).
    // Models are maintained in the static list above.
    logger.info(`anthropic: ${ANTHROPIC_MODELS.length} models (static)`);
    return ANTHROPIC_MODELS;
  }
}
