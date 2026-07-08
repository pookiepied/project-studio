/**
 * Local Model Detection Service
 * Detects capabilities of local models (Ollama) without relying on cloud API
 */

import { Model } from "./modelService";
import { OllamaModel } from "./ollamaService";

interface LocalModelCapabilities {
  supportsVision: boolean;
  supportsTools: boolean;
  contextWindow: number;
  maxTokens: number;
  modelFamily: string;
  parameterSize: string;
}

/**
 * Known model capabilities database
 * This is maintained locally to avoid cloud dependency
 */
const KNOWN_MODEL_CAPABILITIES: Record<string, Partial<LocalModelCapabilities>> = {
  // Vision models
  "llava": { supportsVision: true, contextWindow: 4096 },
  "llava:7b": { supportsVision: true, contextWindow: 4096 },
  "llava:13b": { supportsVision: true, contextWindow: 4096 },
  "llava:34b": { supportsVision: true, contextWindow: 4096 },
  "bakllava": { supportsVision: true, contextWindow: 4096 },
  "moondream": { supportsVision: true, contextWindow: 2048 },
  
  // Tool-capable models
  "llama3.1": { supportsTools: true, contextWindow: 128000 },
  "llama3.1:8b": { supportsTools: true, contextWindow: 128000 },
  "llama3.1:70b": { supportsTools: true, contextWindow: 128000 },
  "llama3.1:405b": { supportsTools: true, contextWindow: 128000 },
  "llama3.2": { supportsTools: true, contextWindow: 128000 },
  "qwen2.5": { supportsTools: true, contextWindow: 32768 },
  "qwen2.5:7b": { supportsTools: true, contextWindow: 32768 },
  "qwen2.5:14b": { supportsTools: true, contextWindow: 32768 },
  "qwen2.5:32b": { supportsTools: true, contextWindow: 32768 },
  "qwen2.5:72b": { supportsTools: true, contextWindow: 32768 },
  
  // Standard chat models
  "llama3": { contextWindow: 8192 },
  "llama3:8b": { contextWindow: 8192 },
  "llama3:70b": { contextWindow: 8192 },
  "llama2": { contextWindow: 4096 },
  "llama2:7b": { contextWindow: 4096 },
  "llama2:13b": { contextWindow: 4096 },
  "llama2:70b": { contextWindow: 4096 },
  "mistral": { contextWindow: 8192 },
  "mistral:7b": { contextWindow: 8192 },
  "mixtral": { contextWindow: 32768 },
  "mixtral:8x7b": { contextWindow: 32768 },
  "mixtral:8x22b": { contextWindow: 65536 },
  "gemma": { contextWindow: 8192 },
  "gemma:2b": { contextWindow: 8192 },
  "gemma:7b": { contextWindow: 8192 },
  "phi3": { contextWindow: 128000 },
  "phi3:mini": { contextWindow: 128000 },
  "phi3:medium": { contextWindow: 128000 },
  "codellama": { contextWindow: 16384 },
  "codellama:7b": { contextWindow: 16384 },
  "codellama:13b": { contextWindow: 16384 },
  "codellama:34b": { contextWindow: 16384 },
};

/**
 * Detect model capabilities from model name and metadata
 */
export function detectLocalModelCapabilities(ollamaModel: OllamaModel): LocalModelCapabilities {
  const modelName = ollamaModel.name.toLowerCase();
  const baseModel = modelName.split(':')[0];
  
  // Check known capabilities
  const knownCapabilities = KNOWN_MODEL_CAPABILITIES[modelName] || KNOWN_MODEL_CAPABILITIES[baseModel];
  
  // Extract parameter size from details
  const parameterSize = ollamaModel.details?.parameter_size || "unknown";
  const modelFamily = ollamaModel.details?.family || baseModel;
  
  // Default capabilities
  const defaultCapabilities: LocalModelCapabilities = {
    supportsVision: false,
    supportsTools: false,
    contextWindow: 4096, // Conservative default
    maxTokens: 4096,
    modelFamily,
    parameterSize,
  };
  
  // Merge with known capabilities
  const capabilities = { ...defaultCapabilities, ...knownCapabilities };
  
  // Pattern-based detection for unknown models
  if (!knownCapabilities) {
    // Vision model detection
    if (/llava|moondream|bakllava|vision/i.test(modelName)) {
      capabilities.supportsVision = true;
    }
    
    // Tool model detection
    if (/llama3\.[1-9]|qwen2\.[5-9]|phi3|mixtral/i.test(modelName)) {
      capabilities.supportsTools = true;
    }
    
    // Context window estimation based on model family
    if (/llama3\.[1-9]|phi3/i.test(modelName)) {
      capabilities.contextWindow = 128000;
    } else if (/mixtral|qwen2\.[5-9]/i.test(modelName)) {
      capabilities.contextWindow = 32768;
    } else if (/codellama/i.test(modelName)) {
      capabilities.contextWindow = 16384;
    } else if (/llama3|mistral|gemma/i.test(modelName)) {
      capabilities.contextWindow = 8192;
    }
  }
  
  capabilities.maxTokens = capabilities.contextWindow;
  
  return capabilities;
}

/**
 * Convert Ollama model to our Model interface
 */
export function convertOllamaToModel(ollamaModel: OllamaModel): Model {
  const capabilities = detectLocalModelCapabilities(ollamaModel);
  
  return {
    id: `local:${ollamaModel.name}`,
    provider: "local",
    type: capabilities.supportsVision ? "multimodal" : "chat",
    name: ollamaModel.name,
    description: `Local Ollama model - ${capabilities.parameterSize} parameters`,
    contextWindow: capabilities.contextWindow,
    maxTokens: capabilities.maxTokens,
    free: true,
    supportsVision: capabilities.supportsVision,
    supportsTools: capabilities.supportsTools,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: capabilities.supportsVision ? ["text", "image"] : ["text"],
    outputTypes: ["text"],
    capabilities: [
      "chat",
      "streaming",
      ...(capabilities.supportsVision ? ["vision"] : []),
      ...(capabilities.supportsTools ? ["tools", "function_calling"] : []),
    ],
    modality: capabilities.supportsVision ? ["text", "vision"] : ["text"],
    architecture: capabilities.modelFamily,
    created: new Date(ollamaModel.modified_at).getTime(),
  };
}

/**
 * Check if a local model supports vision
 */
export function localModelSupportsVision(modelName: string): boolean {
  const baseModel = modelName.toLowerCase().replace('local:', '').split(':')[0];
  const knownCapabilities = KNOWN_MODEL_CAPABILITIES[modelName.replace('local:', '')] || 
                           KNOWN_MODEL_CAPABILITIES[baseModel];
  
  if (knownCapabilities?.supportsVision) return true;
  
  // Pattern-based detection
  return /llava|moondream|bakllava|vision/i.test(modelName);
}

/**
 * Get context window for local model
 */
export function getLocalModelContextWindow(modelName: string): number {
  const baseModel = modelName.toLowerCase().replace('local:', '').split(':')[0];
  const knownCapabilities = KNOWN_MODEL_CAPABILITIES[modelName.replace('local:', '')] || 
                           KNOWN_MODEL_CAPABILITIES[baseModel];
  
  if (knownCapabilities?.contextWindow) return knownCapabilities.contextWindow;
  
  // Pattern-based estimation
  if (/llama3\.[1-9]|phi3/i.test(modelName)) return 128000;
  if (/mixtral|qwen2\.[5-9]/i.test(modelName)) return 32768;
  if (/codellama/i.test(modelName)) return 16384;
  if (/llama3|mistral|gemma/i.test(modelName)) return 8192;
  
  return 4096; // Conservative default
}