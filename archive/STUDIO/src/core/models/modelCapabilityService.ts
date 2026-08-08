/**
 * Model capability detection.
 *
 * Single source of truth for the two capabilities anything actually asks about:
 * vision support and context window. Tool/streaming detection and the
 * suitability/ranking helpers were removed as dead (RT-029); nothing consumed
 * them. Local-model capability detection is separate, in
 * features/models/services/localModelDetection.ts.
 */

import type { Model } from "@/core/models/types";

const DEFAULT_CONTEXT_WINDOW = 6000;

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
