/**
 * Centralized Error Service
 * 
 * Single source of truth for all error handling in the application.
 * Categorizes errors, transforms to user-friendly messages, and routes to appropriate display.
 */

import { reportError as logError } from "./errorReporting";
import { logger } from "../logging/logger";

export type ErrorCategory = 
  | "payment"
  | "rate_limit"
  | "auth"
  | "network"
  | "model"
  | "validation"
  | "server"
  | "unknown";

export type RateLimitType = 
  | "rpm"      // Requests per minute
  | "rpd"      // Requests per day
  | "tpm"      // Tokens per minute
  | "tpd"      // Tokens per day
  | "audio"    // Audio seconds (transcription)
  | "unknown"; // Generic rate limit

export type ErrorDisplay = "toast" | "inline";

export interface CategorizedError {
  category: ErrorCategory;
  userMessage: string;
  technicalMessage: string;
  actionable?: {
    label: string;
    action: string; // Action identifier (e.g., "switch_to_free_model", "retry")
  };
  // Rate limit specific fields
  limitType?: RateLimitType;
  provider?: "groq" | "openrouter" | "unknown";
  retryAfter?: number; // Seconds to wait
}

/**
 * Error patterns for categorization
 */
const ERROR_PATTERNS = {
  payment: [
    /payment required/i,
    /requires?\s+credits/i,
    /insufficient funds/i,
    /billing/i,
    /subscription/i,
    /no credits/i,
    /add credits/i,
    /out of credits/i,
  ],
  rate_limit: [
    /rate limit/i,
    /too many requests/i,
    /429/,
    /quota exceeded/i,
    /requests? per (minute|day|hour)/i,
    /tokens? per (minute|day)/i,
    /rpm|rpd|tpm|tpd/i,
    /audio.*limit/i,
    /exceeded.*limit/i,
  ],
  auth: [
    /unauthorized/i,
    /invalid api key/i,
    /authentication failed/i,
    /401/,
    /403/,
    /forbidden/i,
    /access denied/i,
  ],
  network: [
    /network error/i,
    /failed to fetch/i,
    /connection/i,
    /timeout/i,
    /ECONNREFUSED/i,
    /ENOTFOUND/i,
    /ETIMEDOUT/i,
  ],
  model: [
    /model not found/i,
    /model unavailable/i,
    /model.*not available/i,
    /invalid model/i,
    /model.*does not exist/i,
  ],
  validation: [
    /invalid request/i,
    /missing required field/i,
    /validation error/i,
    /bad request/i,
    /400/,
    /invalid.*parameter/i,
  ],
  server: [
    /500/,
    /502/,
    /503/,
    /504/,
    /internal server error/i,
    /service unavailable/i,
    /bad gateway/i,
  ],
};

/**
 * User-friendly messages for each error category
 */
const USER_MESSAGES: Record<ErrorCategory, string> = {
  payment: "This model requires credits. Please add credits to your account or try a free model.",
  rate_limit: "Too many requests. Please wait a moment and try again.",
  auth: "Authentication failed. Please check your API settings.",
  network: "Connection failed. Please check your internet connection and try again.",
  model: "This model is currently unavailable. Please try another model.",
  validation: "Invalid request. Please check your input and try again.",
  server: "Server error. Please try again in a moment.",
  unknown: "An unexpected error occurred. Please try again.",
};

/**
 * Parse error from various formats
 */
function parseErrorMessage(error: any): string {
  if (typeof error === "string") {
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (error?.error?.message) {
    return error.error.message;
  }

  if (error?.message) {
    return error.message;
  }

  return "Unknown error";
}

/**
 * Extract clean message from API error responses
 * Handles formats like: 'HTTP 500: {"error":{"message":"..."}}'
 */
function extractCleanMessage(rawError: string): string {
  // Try to extract JSON from error string
  const jsonMatch = rawError.match(/\{.*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed.error?.message) {
        return parsed.error.message;
      }
    } catch {
      // Not valid JSON, continue
    }
  }

  // Remove HTTP status prefix
  const cleanedError = rawError.replace(/^HTTP \d+:\s*/, "");
  
  return cleanedError;
}

/**
 * Categorize error based on message content
 */
function categorizeError(errorMessage: string): ErrorCategory {
  const lowerMessage = errorMessage.toLowerCase();

  for (const [category, patterns] of Object.entries(ERROR_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lowerMessage)) {
        return category as ErrorCategory;
      }
    }
  }

  return "unknown";
}

/**
 * Detect rate limit type from error message
 */
function detectRateLimitType(errorMessage: string): RateLimitType {
  const lowerMessage = errorMessage.toLowerCase();
  
  // Check for specific limit types
  if (/requests? per minute|rpm|\d+ requests?\/min/i.test(lowerMessage)) {
    return "rpm";
  }
  if (/requests? per day|rpd|\d+ requests?\/day|daily limit/i.test(lowerMessage)) {
    return "rpd";
  }
  if (/tokens? per minute|tpm|\d+ tokens?\/min/i.test(lowerMessage)) {
    return "tpm";
  }
  if (/tokens? per day|tpd|\d+ tokens?\/day/i.test(lowerMessage)) {
    return "tpd";
  }
  if (/audio|seconds? per (hour|day)|transcription/i.test(lowerMessage)) {
    return "audio";
  }
  
  return "unknown";
}

/**
 * Extract retry-after time from error message
 * Returns seconds to wait, or undefined if not found
 */
function extractRetryAfter(errorMessage: string): number | undefined {
  // Try to find "wait X seconds/minutes"
  const secondsMatch = errorMessage.match(/wait (\d+) seconds?/i);
  if (secondsMatch) {
    return parseInt(secondsMatch[1], 10);
  }
  
  const minutesMatch = errorMessage.match(/wait (\d+) minutes?/i);
  if (minutesMatch) {
    return parseInt(minutesMatch[1], 10) * 60;
  }
  
  // Try to find "try again in X seconds/minutes"
  const tryAgainSecondsMatch = errorMessage.match(/try again in (\d+) seconds?/i);
  if (tryAgainSecondsMatch) {
    return parseInt(tryAgainSecondsMatch[1], 10);
  }
  
  const tryAgainMinutesMatch = errorMessage.match(/try again in (\d+) minutes?/i);
  if (tryAgainMinutesMatch) {
    return parseInt(tryAgainMinutesMatch[1], 10) * 60;
  }
  
  return undefined;
}

/**
 * Format wait time in human-readable format
 */
function formatWaitTime(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }
  const minutes = Math.ceil(seconds / 60);
  return `${minutes}m`;
}

/**
 * Generate user-friendly rate limit message
 * Now uses dynamic limits from headers instead of hardcoded values
 */
function getRateLimitMessage(
  limitType: RateLimitType,
  retryAfter?: number,
  rateLimitInfo?: Record<string, string | null>
): string {
  const waitText = retryAfter ? formatWaitTime(retryAfter) : undefined;
  
  // Try to use actual limits from headers (DYNAMIC)
  if (rateLimitInfo) {
    const limitRequests = rateLimitInfo.limitRequests;
    const limitTokens = rateLimitInfo.limitTokens;
    
    // Requests limit
    if ((limitType === "rpm" || limitType === "rpd") && limitRequests) {
      const unit = limitType === "rpm" ? "requests/min" : "requests/day";
      if (waitText) {
        return `Rate limit: ${limitRequests} ${unit}. Try again in ${waitText}.`;
      }
      return `Rate limit: ${limitRequests} ${unit}. Please wait.`;
    }
    
    // Token limit
    if ((limitType === "tpm" || limitType === "tpd") && limitTokens) {
      const unit = limitType === "tpm" ? "tokens/min" : "tokens/day";
      if (waitText) {
        return `Rate limit: ${limitTokens} ${unit}. Try again in ${waitText}.`;
      }
      return `Rate limit: ${limitTokens} ${unit}. Please wait.`;
    }
  }
  
  // Fallback messages (no specific numbers - future-proof)
  if (limitType === "audio") {
    return "Audio transcription limit reached. Please wait before transcribing more.";
  }
  
  // Generic rate limit message
  if (waitText) {
    return `Rate limit reached. Try again in ${waitText}.`;
  }
  
  return "Rate limit reached. Please wait and try again.";
}

/**
 * Get actionable suggestion for error
 */
function getActionable(category: ErrorCategory): CategorizedError["actionable"] | undefined {
  switch (category) {
    case "payment":
      return {
        label: "Try Free Model",
        action: "switch_to_free_model",
      };
    case "network":
      return {
        label: "Retry",
        action: "retry",
      };
    case "rate_limit":
      return {
        label: "Wait & Retry",
        action: "retry_after_delay",
      };
    default:
      return undefined;
  }
}

/**
 * Main error service class
 */
class ErrorService {
  /**
   * Process and categorize an error
   * @param error - The error object or message
   * @param rateLimitInfo - Optional rate limit headers from API response
   */
  categorize(error: any, rateLimitInfo?: Record<string, string | null>): CategorizedError {
    const rawMessage = parseErrorMessage(error);
    const technicalMessage = extractCleanMessage(rawMessage);
    const category = categorizeError(technicalMessage);
    
    // Enhanced rate limit handling
    let userMessage: string;
    let limitType: RateLimitType | undefined;
    let provider: "groq" | "openrouter" | "unknown" | undefined;
    let retryAfter: number | undefined;
    
    if (category === "rate_limit") {
      // Detect provider for logging/tracking purposes
      const lowerMessage = technicalMessage.toLowerCase();
      if (lowerMessage.includes("groq")) {
        provider = "groq";
      } else if (lowerMessage.includes("openrouter")) {
        provider = "openrouter";
      } else {
        provider = "unknown";
      }
      
      limitType = detectRateLimitType(technicalMessage);
      
      // Try to get retry-after from headers first, then from message
      if (rateLimitInfo?.retryAfter) {
        retryAfter = parseInt(rateLimitInfo.retryAfter, 10);
      } else {
        retryAfter = extractRetryAfter(technicalMessage);
      }
      
      userMessage = getRateLimitMessage(limitType, retryAfter, rateLimitInfo);
    } else {
      userMessage = USER_MESSAGES[category];
    }
    
    const actionable = getActionable(category);

    // Log for developers
    if (import.meta.env.DEV) {
      logger.debug('ErrorService', 'Error categorized', {
        category: category.toUpperCase(),
        userMessage,
        technicalMessage,
        rawMessage,
        provider,
        limitType,
        retryAfter,
        rateLimitInfo
      });
    }

    // Report to error tracking
    if (error instanceof Error) {
      logError(error, { category, userMessage, provider, limitType });
    }

    return {
      category,
      userMessage,
      technicalMessage,
      actionable,
      limitType,
      provider,
      retryAfter,
    };
  }

  /**
   * Get user-friendly message from any error
   */
  getUserMessage(error: any): string {
    const categorized = this.categorize(error);
    return categorized.userMessage;
  }

  /**
   * Check if error is a specific category
   */
  isCategory(error: any, category: ErrorCategory): boolean {
    const categorized = this.categorize(error);
    return categorized.category === category;
  }

  /**
   * Get error category
   */
  getCategory(error: any): ErrorCategory {
    const categorized = this.categorize(error);
    return categorized.category;
  }
  
  /**
   * Check if error is a rate limit error
   */
  isRateLimit(error: any): boolean {
    return this.isCategory(error, "rate_limit");
  }
  
  /**
   * Get retry-after time for rate limit errors
   * Returns seconds to wait, or undefined if not a rate limit error
   */
  getRetryAfter(error: any): number | undefined {
    const categorized = this.categorize(error);
    return categorized.retryAfter;
  }
}

// Export singleton instance
export const errorService = new ErrorService();
