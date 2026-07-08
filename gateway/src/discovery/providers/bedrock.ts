/**
 * Amazon Bedrock Provider Discovery
 *
 * Static catalogue — the Bedrock control-plane API requires separate IAM
 * permissions and cross-region endpoint configuration that differ from the
 * data-plane keys. We maintain a curated static list that is updated here
 * rather than at runtime.
 *
 * Cross-region inference: US-East models use the `us.*` prefix.
 * Pricing: null — Bedrock pricing varies by region and is complex;
 * Claude 4.x pricing is not yet published. Frontend shows "N/A".
 */

import { ProviderDiscovery } from "../base";
import { Model }             from "../../types";

interface BedrockModelDef {
  id: string;
  name: string;
  type: Model["type"];
  description: string;
  contextWindow: number;
  maxTokens?: number;
  supportsTools?: boolean;
  supportsVision?: boolean;
  supportsStreaming?: boolean;
  capabilities?: string[];
  specialFeatures?: ("thinking" | "reasoning" | "code" | "math" | "creative")[];
  inputTypes?: Model["inputTypes"];
  outputTypes?: Model["outputTypes"];
}

const CATALOG: BedrockModelDef[] = [
  // ── Anthropic Claude ──────────────────────────────────────────────────────
  {
    id:           "us.anthropic.claude-opus-4-8",
    name:         "Claude Opus 4.8 (Bedrock)",
    type:         "chat",
    description:  "Anthropic Claude Opus 4.8 via Amazon Bedrock cross-region inference",
    contextWindow: 200000,
    maxTokens:    16000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    capabilities: ["chat", "reasoning", "vision", "tool-calling", "streaming"],
    specialFeatures: ["thinking", "reasoning", "code", "math"],
    inputTypes:  ["text", "image"],
    outputTypes: ["text"],
  },
  {
    id:           "us.anthropic.claude-sonnet-4-6-v1",
    name:         "Claude Sonnet 4.6 (Bedrock)",
    type:         "chat",
    description:  "Anthropic Claude Sonnet 4.6 via Amazon Bedrock cross-region inference",
    contextWindow: 200000,
    maxTokens:    16000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    capabilities: ["chat", "reasoning", "vision", "tool-calling", "streaming"],
    specialFeatures: ["thinking"],
    inputTypes:  ["text", "image"],
    outputTypes: ["text"],
  },
  {
    id:           "us.anthropic.claude-haiku-4-5-20251001-v1:0",
    name:         "Claude Haiku 4.5 (Bedrock)",
    type:         "chat",
    description:  "Anthropic Claude Haiku 4.5 via Amazon Bedrock — fast and cost-efficient",
    contextWindow: 200000,
    maxTokens:    16000,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    capabilities: ["chat", "vision", "tool-calling", "streaming"],
    inputTypes:  ["text", "image"],
    outputTypes: ["text"],
  },
  {
    id:           "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
    name:         "Claude 3.5 Sonnet v2 (Bedrock)",
    type:         "chat",
    description:  "Anthropic Claude 3.5 Sonnet v2 via Amazon Bedrock",
    contextWindow: 200000,
    maxTokens:    8192,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    capabilities: ["chat", "vision", "tool-calling", "streaming"],
    inputTypes:  ["text", "image"],
    outputTypes: ["text"],
  },
  // ── Amazon Nova ───────────────────────────────────────────────────────────
  {
    id:           "us.amazon.nova-pro-v1:0",
    name:         "Amazon Nova Pro (Bedrock)",
    type:         "multimodal",
    description:  "Amazon Nova Pro — multimodal model for complex tasks",
    contextWindow: 300000,
    maxTokens:    5120,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    capabilities: ["chat", "vision", "tool-calling", "streaming"],
    inputTypes:  ["text", "image", "video"],
    outputTypes: ["text"],
  },
  {
    id:           "us.amazon.nova-lite-v1:0",
    name:         "Amazon Nova Lite (Bedrock)",
    type:         "multimodal",
    description:  "Amazon Nova Lite — low-cost multimodal model",
    contextWindow: 300000,
    maxTokens:    5120,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    capabilities: ["chat", "vision", "tool-calling", "streaming"],
    inputTypes:  ["text", "image", "video"],
    outputTypes: ["text"],
  },
  {
    id:           "us.amazon.nova-micro-v1:0",
    name:         "Amazon Nova Micro (Bedrock)",
    type:         "chat",
    description:  "Amazon Nova Micro — ultra-fast text-only model",
    contextWindow: 128000,
    maxTokens:    5120,
    supportsTools: true,
    supportsStreaming: true,
    capabilities: ["chat", "tool-calling", "streaming"],
    inputTypes:  ["text"],
    outputTypes: ["text"],
  },
  // ── Meta Llama ────────────────────────────────────────────────────────────
  {
    id:           "us.meta.llama3-3-70b-instruct-v1:0",
    name:         "Llama 3.3 70B Instruct (Bedrock)",
    type:         "chat",
    description:  "Meta Llama 3.3 70B via Amazon Bedrock",
    contextWindow: 128000,
    maxTokens:    8192,
    supportsTools: true,
    supportsStreaming: true,
    capabilities: ["chat", "tool-calling", "streaming"],
    inputTypes:  ["text"],
    outputTypes: ["text"],
  },
  {
    id:           "us.meta.llama4-maverick-17b-instruct-v1:0",
    name:         "Llama 4 Maverick 17B (Bedrock)",
    type:         "multimodal",
    description:  "Meta Llama 4 Maverick — multimodal mixture-of-experts via Bedrock",
    contextWindow: 1048576,
    maxTokens:    8192,
    supportsTools: true,
    supportsVision: true,
    supportsStreaming: true,
    capabilities: ["chat", "vision", "tool-calling", "streaming"],
    inputTypes:  ["text", "image"],
    outputTypes: ["text"],
  },
  {
    id:           "us.deepseek.r1-v1:0",
    name:         "DeepSeek R1 (Bedrock)",
    type:         "chat",
    description:  "DeepSeek R1 reasoning model via Amazon Bedrock",
    contextWindow: 64000,
    maxTokens:    32768,
    supportsTools: false,
    supportsStreaming: true,
    capabilities: ["chat", "reasoning", "math", "code", "streaming"],
    specialFeatures: ["reasoning", "math", "code"],
    inputTypes:  ["text"],
    outputTypes: ["text"],
  },
  // ── Embeddings ────────────────────────────────────────────────────────────
  {
    id:           "amazon.titan-embed-text-v2:0",
    name:         "Titan Embed Text v2 (Bedrock)",
    type:         "embedding",
    description:  "Amazon Titan Text Embeddings v2 — up to 1024 dimensions",
    contextWindow: 8192,
    supportsStreaming: false,
    capabilities: ["embeddings"],
    inputTypes:  ["text"],
    outputTypes: ["embedding"],
  },
  {
    id:           "cohere.embed-english-v3",
    name:         "Cohere Embed English v3 (Bedrock)",
    type:         "embedding",
    description:  "Cohere Embed English v3 via Amazon Bedrock",
    contextWindow: 512,
    supportsStreaming: false,
    capabilities: ["embeddings"],
    inputTypes:  ["text"],
    outputTypes: ["embedding"],
  },
];

export class BedrockDiscovery implements ProviderDiscovery {
  name = "bedrock";

  async discoverModels(): Promise<Model[]> {
    return CATALOG.map(def => ({
      id:           `bedrock:${def.id}`,
      provider:     "bedrock",
      type:         def.type,
      name:         def.name,
      description:  def.description,
      contextWindow: def.contextWindow,
      maxTokens:    def.maxTokens,
      pricing:      null,
      free:         false,
      capabilities: def.capabilities ?? ["chat"],
      modality:     def.inputTypes ?? ["text"],
      supportsStreaming:     def.supportsStreaming ?? true,
      supportsTools:         def.supportsTools ?? false,
      supportsParallelTools: def.supportsTools ?? false,
      supportsSystemPrompts: def.type !== "embedding",
      supportsVision:        def.supportsVision ?? false,
      specialFeatures:       def.specialFeatures,
      inputTypes:   def.inputTypes  ?? ["text"],
      outputTypes:  def.outputTypes ?? ["text"],
    }));
  }
}
