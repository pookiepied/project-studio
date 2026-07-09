/**
 * Fallback Service
 * Provides fallback mechanisms for various system failures
 */

import { Model } from "@/features/models/services/modelService";
import { AttachmentLimits } from "@/features/chat/attachments/attachmentLimits";
import { errorService } from "../errors/errorService";
import { detectVisionSupport, detectContextWindow } from "@/features/models/services/modelCapabilityService";
import { logger } from "../logging/logger";

/**
 * Default fallback values when systems fail
 */
export const FALLBACK_VALUES = {
  CONTEXT_WINDOW: 6000,
  MAX_ATTACHMENTS: 3,
  MAX_TEXT_FILE_SIZE: 1024 * 1024, // 1MB
  MAX_IMAGE_FILE_SIZE: 20 * 1024 * 1024, // 20MB
  MAX_TOKENS_FOR_ATTACHMENTS: 1800, // 30% of 6000
  RESERVED_TOKENS_FOR_OUTPUT: 1500, // 25% of 6000
  AVAILABLE_TOKENS_FOR_INPUT: 3000, // 50% of 6000
} as const;

/**
 * Create fallback model when model data is unavailable
 */
export function createFallbackModel(modelId: string): Model {
  const isLocal = modelId.startsWith("local:");
  const isVision = /vision|llava|moondream|gpt-4o|claude-3|gemini.*vision/i.test(modelId);
  const isTools = /gpt-4|claude-3|gemini|llama-3\.[1-9]|qwen2\.[5-9]/i.test(modelId);
  
  return {
    id: modelId,
    provider: isLocal ? "local" : "unknown",
    type: isVision ? "multimodal" : "chat",
    name: modelId.replace(/^(local:|groq:|openrouter:)/, ""),
    description: "Fallback model configuration",
    contextWindow: FALLBACK_VALUES.CONTEXT_WINDOW,
    maxTokens: FALLBACK_VALUES.CONTEXT_WINDOW,
    free: isLocal,
    supportsVision: isVision,
    supportsTools: isTools,
    supportsStreaming: true,
    supportsSystemPrompts: true,
    inputTypes: isVision ? ["text", "image"] : ["text"],
    outputTypes: ["text"],
    capabilities: [
      "chat",
      "streaming",
      ...(isVision ? ["vision"] : []),
      ...(isTools ? ["tools", "function_calling"] : []),
    ],
    modality: isVision ? ["text", "vision"] : ["text"],
  };
}

/**
 * Create fallback attachment limits
 */
export function createFallbackAttachmentLimits(): AttachmentLimits {
  return {
    maxAttachments: FALLBACK_VALUES.MAX_ATTACHMENTS,
    maxTokensForAttachments: FALLBACK_VALUES.MAX_TOKENS_FOR_ATTACHMENTS,
    maxFileSizeText: FALLBACK_VALUES.MAX_TEXT_FILE_SIZE,
    maxFileSizeImage: FALLBACK_VALUES.MAX_IMAGE_FILE_SIZE,
    reservedTokensForOutput: FALLBACK_VALUES.RESERVED_TOKENS_FOR_OUTPUT,
    availableTokensForInput: FALLBACK_VALUES.AVAILABLE_TOKENS_FOR_INPUT,
  };
}

/**
 * Safe model lookup with fallback
 */
export function safeGetModel(models: Model[], modelId: string): Model {
  const model = models.find(m => m.id === modelId);
  if (model) return model;
  
  logger.warn('Fallback', `Model ${modelId} not found, using fallback configuration`);
  return createFallbackModel(modelId);
}

/**
 * Safe context window calculation with fallback
 */
export function safeGetContextWindow(models: Model[], modelId: string): number {
  try {
    const model = safeGetModel(models, modelId);
    return detectContextWindow(model);
  } catch (error) {
    logger.warn('Fallback', `Context window calculation failed for ${modelId}`, error);
    return FALLBACK_VALUES.CONTEXT_WINDOW;
  }
}

/**
 * Safe vision model check with fallback
 */
export function safeIsVisionModel(models: Model[], modelId: string): boolean {
  try {
    const model = safeGetModel(models, modelId);
    return detectVisionSupport(model);
  } catch (error) {
    logger.warn('Fallback', `Vision model check failed for ${modelId}`, error);
    return /vision|llava|moondream|gpt-4o|claude-3|gemini.*vision/i.test(modelId);
  }
}

/**
 * Handle network failures gracefully
 */
export function handleNetworkFailure(error: any): { isNetworkError: boolean; userMessage: string } {
  const errorMessage = error?.message || String(error);
  const isNetworkError = /network|fetch|connection|timeout|offline/i.test(errorMessage);
  
  if (isNetworkError) {
    return {
      isNetworkError: true,
      userMessage: "Network connection failed. Using offline mode with local models and cached data."
    };
  }
  
  return {
    isNetworkError: false,
    userMessage: errorService.getUserMessage(error)
  };
}

/**
 * Retry mechanism with exponential backoff
 */
export async function retryWithBackoff<T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> {
  let lastError: any;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      if (attempt === maxRetries) {
        break;
      }
      
      const delay = baseDelay * Math.pow(2, attempt);
      logger.warn('Retry', `Attempt ${attempt + 1} failed, retrying in ${delay}ms`, error);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  throw lastError;
}