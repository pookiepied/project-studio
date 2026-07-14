/**
 * Azure OpenAI Provider Discovery
 *
 * Azure has no data-plane model listing API accessible with standard API keys.
 * Discovery is driven entirely by AZURE_DEPLOYMENTS (JSON string in env),
 * which maps modelId → deploymentName.
 *
 * Example AZURE_DEPLOYMENTS:
 *   {"gpt-4o":"my-gpt4o-deployment","text-embedding-3-large":"my-embed-deployment"}
 *
 * Pricing: null — Azure pricing varies by region and agreement; display "N/A".
 */

import { ProviderDiscovery } from "../base";
import { Model }             from "../../types";
import { logger }            from "../../logger";

interface AzureModelMeta {
  type: Model["type"];
  description: string;
  contextWindow: number;
  maxTokens?: number;
  supportsVision?: boolean;
  supportsTools?: boolean;
  capabilities?: string[];
  specialFeatures?: ("thinking" | "reasoning" | "code" | "math" | "creative")[];
  inputTypes?: Model["inputTypes"];
  outputTypes?: Model["outputTypes"];
}

const WELL_KNOWN: Record<string, AzureModelMeta> = {
  "gpt-4o":                  { type: "multimodal", description: "GPT-4o via Azure OpenAI", contextWindow: 128000, maxTokens: 16384, supportsVision: true, supportsTools: true, capabilities: ["chat", "vision", "tool-calling", "streaming"], inputTypes: ["text", "image"], outputTypes: ["text"] },
  "gpt-4o-mini":             { type: "chat",       description: "GPT-4o Mini via Azure OpenAI", contextWindow: 128000, maxTokens: 16384, supportsVision: true, supportsTools: true, capabilities: ["chat", "vision", "tool-calling", "streaming"], inputTypes: ["text", "image"], outputTypes: ["text"] },
  "o3":                      { type: "chat",       description: "o3 reasoning model via Azure OpenAI", contextWindow: 200000, maxTokens: 100000, supportsTools: true, capabilities: ["chat", "reasoning", "math", "code", "tool-calling"], specialFeatures: ["reasoning", "math", "code"], inputTypes: ["text"], outputTypes: ["text"] },
  "o4-mini":                 { type: "chat",       description: "o4 Mini reasoning model via Azure OpenAI", contextWindow: 200000, maxTokens: 100000, supportsTools: true, capabilities: ["chat", "reasoning", "tool-calling"], specialFeatures: ["reasoning"], inputTypes: ["text"], outputTypes: ["text"] },
  "gpt-4.1":                 { type: "multimodal", description: "GPT-4.1 via Azure OpenAI", contextWindow: 1048576, maxTokens: 32768, supportsVision: true, supportsTools: true, capabilities: ["chat", "vision", "tool-calling", "streaming"], inputTypes: ["text", "image"], outputTypes: ["text"] },
  "gpt-image-1":             { type: "image",      description: "GPT Image 1 via Azure OpenAI", contextWindow: 32768, capabilities: ["image-generation"], inputTypes: ["text"], outputTypes: ["image"] },
  "dall-e-3":                { type: "image",      description: "DALL-E 3 via Azure OpenAI", contextWindow: 4000, capabilities: ["image-generation"], inputTypes: ["text"], outputTypes: ["image"] },
  "text-embedding-3-large":  { type: "embedding",  description: "text-embedding-3-large via Azure OpenAI", contextWindow: 8191, capabilities: ["embeddings"], inputTypes: ["text"], outputTypes: ["embedding"] },
  "text-embedding-3-small":  { type: "embedding",  description: "text-embedding-3-small via Azure OpenAI", contextWindow: 8191, capabilities: ["embeddings"], inputTypes: ["text"], outputTypes: ["embedding"] },
  "text-embedding-ada-002":  { type: "embedding",  description: "text-embedding-ada-002 via Azure OpenAI", contextWindow: 8191, capabilities: ["embeddings"], inputTypes: ["text"], outputTypes: ["embedding"] },
  "whisper":                 { type: "audio",      description: "Whisper STT via Azure OpenAI", contextWindow: 0, capabilities: ["transcription"], inputTypes: ["audio"], outputTypes: ["text"] },
  "tts":                     { type: "tts",        description: "TTS via Azure OpenAI", contextWindow: 4096, capabilities: ["tts"], inputTypes: ["text"], outputTypes: ["audio"] },
};

function describeUnknown(modelId: string): AzureModelMeta {
  const lower = modelId.toLowerCase();
  if (lower.includes("embed"))  return { type: "embedding", description: `Embedding model: ${modelId}`, contextWindow: 8192, capabilities: ["embeddings"], inputTypes: ["text"], outputTypes: ["embedding"] };
  if (lower.includes("dall-e") || lower.includes("image")) return { type: "image", description: `Image model: ${modelId}`, contextWindow: 4000, capabilities: ["image-generation"], inputTypes: ["text"], outputTypes: ["image"] };
  if (lower.includes("whisper") || lower.includes("stt")) return { type: "audio", description: `STT model: ${modelId}`, contextWindow: 0, capabilities: ["transcription"], inputTypes: ["audio"], outputTypes: ["text"] };
  if (lower.includes("tts")) return { type: "tts", description: `TTS model: ${modelId}`, contextWindow: 4096, capabilities: ["tts"], inputTypes: ["text"], outputTypes: ["audio"] };
  return { type: "chat", description: `Azure OpenAI deployment: ${modelId}`, contextWindow: 128000, maxTokens: 16384, supportsVision: false, supportsTools: true, capabilities: ["chat", "tool-calling"], inputTypes: ["text"], outputTypes: ["text"] };
}

export class AzureDiscovery implements ProviderDiscovery {
  name = "azure";

  constructor(
    private readonly resourceName: string | undefined,
    private readonly deploymentMapJson: string | undefined,
  ) {}

  async discoverModels(): Promise<Model[]> {
    if (!this.resourceName || !this.deploymentMapJson) {
      logger.info("azure: Skipped (AZURE_RESOURCE_NAME or AZURE_DEPLOYMENTS not configured)");
      return [];
    }

    let deploymentMap: Record<string, string>;
    try {
      deploymentMap = JSON.parse(this.deploymentMapJson);
    } catch {
      logger.error("azure: AZURE_DEPLOYMENTS is not valid JSON — skipping discovery");
      return [];
    }

    const models: Model[] = [];

    for (const [modelId, _deploymentName] of Object.entries(deploymentMap)) {
      const meta = WELL_KNOWN[modelId] ?? describeUnknown(modelId);

      models.push({
        id:           `azure:${modelId}`,
        provider:     "azure",
        type:         meta.type,
        name:         meta.description,
        description:  meta.description,
        contextWindow: meta.contextWindow,
        maxTokens:    meta.maxTokens,
        pricing:      null,
        free:         false,
        capabilities: meta.capabilities ?? ["chat"],
        modality:     (meta.inputTypes ?? ["text"]).filter((t): t is "text" | "image" | "video" => t !== "audio"),
        supportsStreaming:     meta.type === "chat" || meta.type === "multimodal",
        supportsTools:         meta.supportsTools ?? false,
        supportsParallelTools: meta.supportsTools ?? false,
        supportsSystemPrompts: meta.type !== "embedding",
        supportsVision:        meta.supportsVision ?? false,
        specialFeatures:       meta.specialFeatures,
        inputTypes:   meta.inputTypes  ?? ["text"],
        outputTypes:  meta.outputTypes ?? ["text"],
      });
    }

    logger.info(`azure: ${models.length} deployments from AZURE_DEPLOYMENTS map`);
    return models;
  }
}
