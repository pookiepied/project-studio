import { Model } from "@/features/models/services/modelService";
import { FileAttachment, estimateAttachmentTokens } from "./fileAttachmentService";
import { safeGetContextWindow, createFallbackAttachmentLimits, FALLBACK_VALUES } from "@/core/network/fallbackService";
import { logger } from "@/core/logging/logger";

export interface AttachmentLimits {
  maxAttachments: number;
  maxTokensForAttachments: number;
  maxFileSizeText: number;
  maxFileSizeImage: number;
  reservedTokensForOutput: number;
  availableTokensForInput: number;
}

export function calculateAttachmentLimits(
  models: Model[], 
  modelId: string
): AttachmentLimits {
  try {
    const contextWindow = safeGetContextWindow(models, modelId);
    
    const reservedTokensForOutput = Math.floor(contextWindow * 0.25);
    const systemAndFormattingTokens = Math.floor(contextWindow * 0.10);
    const availableTokensForInput = contextWindow - reservedTokensForOutput - systemAndFormattingTokens;
    const maxTokensForAttachments = Math.floor(availableTokensForInput * 0.30);
    
    let maxAttachments: number;
    if (contextWindow >= 100000) {
      maxAttachments = 20;
    } else if (contextWindow >= 32000) {
      maxAttachments = 15;
    } else if (contextWindow >= 16000) {
      maxAttachments = 10;
    } else if (contextWindow >= 8000) {
      maxAttachments = 5;
    } else {
      maxAttachments = 3;
    }
    
    return {
      maxAttachments,
      maxTokensForAttachments,
      maxFileSizeText: FALLBACK_VALUES.MAX_TEXT_FILE_SIZE,
      maxFileSizeImage: FALLBACK_VALUES.MAX_IMAGE_FILE_SIZE,
      reservedTokensForOutput,
      availableTokensForInput,
    };
  } catch (error) {
    logger.warn('AttachmentLimits', `Calculation failed for model ${modelId}, using fallback`, error);
    return createFallbackAttachmentLimits();
  }
}

/**
 * Validate attachments against model limits
 */
export function validateAttachments(
  attachments: FileAttachment[],
  models: Model[],
  modelId: string
): { isValid: boolean; error?: string; limits: AttachmentLimits } {
  const limits = calculateAttachmentLimits(models, modelId);
  
  // Check attachment count
  if (attachments.length > limits.maxAttachments) {
    return {
      isValid: false,
      error: `Too many attachments. Maximum ${limits.maxAttachments} files allowed for this model.`,
      limits,
    };
  }
  
  // Check individual file sizes
  for (const attachment of attachments) {
    const maxSize = attachment.isImage ? limits.maxFileSizeImage : limits.maxFileSizeText;
    if (attachment.size > maxSize) {
      const maxSizeStr = attachment.isImage ? "20MB" : "1MB";
      return {
        isValid: false,
        error: `File "${attachment.name}" is too large. Maximum size is ${maxSizeStr}.`,
        limits,
      };
    }
  }
  
  // Check total token usage for text files
  const textAttachments = attachments.filter(a => !a.isImage);
  const totalTokens = textAttachments.reduce((sum, attachment) => {
    return sum + estimateAttachmentTokens(attachment);
  }, 0);
  
  if (totalTokens > limits.maxTokensForAttachments) {
    return {
      isValid: false,
      error: `Attachments contain too much text (${totalTokens} tokens). Maximum ${limits.maxTokensForAttachments} tokens allowed for this model.`,
      limits,
    };
  }
  
  return { isValid: true, limits };
}