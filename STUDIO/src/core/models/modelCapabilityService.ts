/**
 * Centralized Model Capability Service
 * Single source of truth for all model capability detection
 */

import type { Model } from "@/core/models/types";

const DEFAULT_CONTEXT_WINDOW = 6000;

export interface ModelCapabilities {
  supportsVision: boolean;
  supportsTools: boolean;
  supportsStreaming: boolean;
  contextWindow: number;
  maxTokens: number;
  isLocal: boolean;
  isFree: boolean;
  provider: string;
}

/**
 * Known model patterns for capability detection
 */
const CAPABILITY_PATTERNS = {
  vision: [
    /gpt-4.*vision/i,
    /gpt-4o/i,
    /claude-3/i,
    /gemini.*vision/i,
    /llava/i,
    /moondream/i,
    /bakllava/i,
    /vision/i,
    /qwen.*vl/i,
    /qwen-vl/i
  ],
  tools: [
    /gpt-4/i,
    /gpt-3\.5-turbo/i,
    /claude-3/i,
    /claude-[4-9]/i,
    /gemini.*pro/i,
    /gemini.*flash/i,
    /llama-?3\.[1-9]/i,
    /llama3\.[1-9]/i,
    /qwen2\.[5-9]/i,
    /qwen3/i,
    /qwen.*max/i,
    /qwen.*plus/i,
    /qwen.*coder/i,
    /mistral-large/i,
    /mistral-small/i,
    /mixtral/i,
    /phi-?3/i,
    /phi-?4/i,
  ],
  longContext: [
    /llama-?3\.[1-9]/i,
    /phi3/i,
    /claude-3/i,
    /gemini.*pro/i,
    /qwen.*plus/i,
    /qwen.*long/i
  ]
};

/**
 * Context window estimation by model family
 */
const CONTEXT_WINDOWS = {
  "gpt-4": 128000,
  "gpt-4o": 128000,
  "claude-3": 200000,
  "gemini-pro": 1000000,
  "llama-3.1": 128000,
  "llama-3.2": 128000,
  "phi3": 128000,
  "mixtral": 32768,
  "qwen2.5": 32768,
  "codellama": 16384,
  "llama-3": 8192,
  "mistral": 8192,
  "gemma": 8192,
  "llama-2": 4096
};

/**
 * Get comprehensive model capabilities
 */
export function getModelCapabilities(model: Model): ModelCapabilities {
  const modelId = model.id.toLowerCase();
  
  return {
    supportsVision: detectVisionSupport(model),
    supportsTools: detectToolSupport(model),
    supportsStreaming: detectStreamingSupport(model),
    contextWindow: detectContextWindow(model),
    maxTokens: model.maxTokens || detectContextWindow(model),
    isLocal: modelId.startsWith("local:"),
    isFree: model.free === true,
    provider: model.provider
  };
}

/**
 * Detect vision support with multiple fallback methods
 */
export function detectVisionSupport(model: Model): boolean {
  // 1. Explicit model property (highest priority)
  if (typeof model.supportsVision === "boolean") {
    return model.supportsVision;
  }
  
  // 2. Input types check
  if (model.inputTypes?.includes("image")) {
    return true;
  }
  
  // 3. Modality check
  if (model.modality?.includes("vision")) {
    return true;
  }
  
  // 4. Capabilities check
  if (model.capabilities?.some(cap => 
    cap.toLowerCase().includes("vision") || 
    cap.toLowerCase().includes("image")
  )) {
    return true;
  }
  
  // 5. Pattern-based detection (fallback)
  return CAPABILITY_PATTERNS.vision.some(pattern => 
    pattern.test(model.id) || pattern.test(model.name)
  );
}

/**
 * Detect tool/function calling support
 */
export function detectToolSupport(model: Model): boolean {
  // 1. Explicit model property (highest priority)
  if (typeof model.supportsTools === "boolean") {
    return model.supportsTools;
  }
  
  // 2. Capabilities check
  if (model.capabilities?.some(cap => 
    cap.toLowerCase().includes("tool") || 
    cap.toLowerCase().includes("function")
  )) {
    return true;
  }
  
  // 3. Pattern-based detection (fallback)
  return CAPABILITY_PATTERNS.tools.some(pattern => 
    pattern.test(model.id) || pattern.test(model.name)
  );
}

/**
 * Detect streaming support
 */
export function detectStreamingSupport(model: Model): boolean {
  // Default to true unless explicitly disabled
  if (typeof model.supportsStreaming === "boolean") {
    return model.supportsStreaming;
  }
  
  // Check capabilities
  if (model.capabilities?.includes("streaming")) {
    return true;
  }
  
  // Most modern models support streaming
  return true;
}

/**
 * Detect context window with multiple fallback methods
 */
export function detectContextWindow(model: Model): number {
  // 1. Explicit context window (highest priority)
  if (model.contextWindow && model.contextWindow > 0) {
    return model.contextWindow;
  }
  
  // 2. Max tokens fallback
  if (model.maxTokens && model.maxTokens > 0) {
    return model.maxTokens;
  }
  
  // 3. Pattern-based estimation
  const modelId = model.id.toLowerCase();
  const modelName = model.name.toLowerCase();
  
  for (const [family, contextWindow] of Object.entries(CONTEXT_WINDOWS)) {
    if (modelId.includes(family) || modelName.includes(family)) {
      return contextWindow;
    }
  }
  
  // 4. Provider-based estimation
  switch (model.provider) {
    case "openai":
      return 128000; // GPT-4 default
    case "anthropic":
      return 200000; // Claude-3 default
    case "google":
      return 1000000; // Gemini default
    case "local":
      return 8192; // Conservative local default
    default:
      return DEFAULT_CONTEXT_WINDOW;
  }
}

/**
 * Check if model is suitable for specific use case
 */
export function isModelSuitableFor(
  model: Model, 
  requirements: {
    needsVision?: boolean;
    needsTools?: boolean;
    needsStreaming?: boolean;
    minContextWindow?: number;
    mustBeFree?: boolean;
    mustBeLocal?: boolean;
  }
): boolean {
  const capabilities = getModelCapabilities(model);
  
  if (requirements.needsVision && !capabilities.supportsVision) return false;
  if (requirements.needsTools && !capabilities.supportsTools) return false;
  if (requirements.needsStreaming && !capabilities.supportsStreaming) return false;
  if (requirements.minContextWindow && capabilities.contextWindow < requirements.minContextWindow) return false;
  if (requirements.mustBeFree && !capabilities.isFree) return false;
  if (requirements.mustBeLocal && !capabilities.isLocal) return false;
  
  return true;
}

/**
 * Get best model for specific requirements
 */
export function getBestModelFor(
  models: Model[],
  requirements: Parameters<typeof isModelSuitableFor>[1]
): Model | null {
  const suitableModels = models.filter(model => 
    isModelSuitableFor(model, requirements)
  );
  
  if (suitableModels.length === 0) return null;
  
  // Sort by preference: free > large context > newer
  return suitableModels.sort((a, b) => {
    const aCaps = getModelCapabilities(a);
    const bCaps = getModelCapabilities(b);
    
    // Prefer free models
    if (aCaps.isFree && !bCaps.isFree) return -1;
    if (!aCaps.isFree && bCaps.isFree) return 1;
    
    // Prefer larger context windows
    if (aCaps.contextWindow !== bCaps.contextWindow) {
      return bCaps.contextWindow - aCaps.contextWindow;
    }
    
    // Prefer newer models (higher created timestamp)
    const aCreated = a.created || 0;
    const bCreated = b.created || 0;
    return bCreated - aCreated;
  })[0];
}

/**
 * Validate model compatibility with attachments
 */
export function validateModelAttachmentCompatibility(
  model: Model,
  attachments: { isImage: boolean; type: string }[]
): { compatible: boolean; issues: string[] } {
  const capabilities = getModelCapabilities(model);
  const issues: string[] = [];
  
  const hasImages = attachments.some(att => att.isImage);
  if (hasImages && !capabilities.supportsVision) {
    issues.push("Selected model doesn't support image attachments");
  }
  
  const hasLargeFiles = attachments.length > 10;
  if (hasLargeFiles && capabilities.contextWindow < 32000) {
    issues.push("Selected model has limited context for many attachments");
  }
  
  return {
    compatible: issues.length === 0,
    issues
  };
}
