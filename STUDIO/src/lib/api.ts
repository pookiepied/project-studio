import { APIResponse } from "@/types";
import { errorService } from "../core/errors/errorService";
import { tokenManager } from "./tokenManager";
import { apiManager } from "@/core/network/apiManager";
import { logger } from "@/core/logging/logger";


/**
 * Get the current API base URL from API manager
 * For adapter endpoints (chat, models), returns the full endpoint URL
 */
async function getAPIBaseURL(): Promise<string> {
  const endpoints = await apiManager.getEndpoints();
  // For adapter endpoints, we'll use the full URL from endpoints
  // This function is kept for backward compatibility but endpoints should be used directly
  return endpoints.models.replace('/models', '');
}

export async function createHeaders(includeContentType: boolean = true): Promise<HeadersInit> {
  const headers: HeadersInit = {};

  if (includeContentType) {
    headers["Content-Type"] = "application/json";
  }

  // JWT Access Token (user authentication)
  const accessToken = await tokenManager.getAccessToken();
  if (accessToken) {
    logger.debug('API', 'Using JWT access token for authentication');
    headers["Authorization"] = `Bearer ${accessToken}`;
    return headers;
  }

  logger.warn('API', 'No authentication method available - API not configured');
  return headers;
}

/**
 * Extract rate limit information from response headers
 */
function extractRateLimitInfo(response: Response): Record<string, string | null> {
  return {
    limitRequests: response.headers.get('x-ratelimit-limit-requests'),
    limitTokens: response.headers.get('x-ratelimit-limit-tokens'),
    remainingRequests: response.headers.get('x-ratelimit-remaining-requests'),
    remainingTokens: response.headers.get('x-ratelimit-remaining-tokens'),
    resetRequests: response.headers.get('x-ratelimit-reset-requests'),
    resetTokens: response.headers.get('x-ratelimit-reset-tokens'),
    retryAfter: response.headers.get('retry-after'),
  };
}

export const apiClient = {
  async get<T>(endpoint: string): Promise<APIResponse<T>> {
    try {
      const baseUrl = await getAPIBaseURL();
      if (!baseUrl) {
        return {
          success: false,
          error: "API not configured. Please configure your API in settings.",
        };
      }

      const response = await fetch(`${baseUrl}${endpoint}`, {
        headers: await createHeaders(),
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        const rawError = errorData.error?.message || `HTTP ${response.status}`;
        
        // Extract rate limit headers for 429 errors
        const rateLimitInfo = response.status === 429 ? extractRateLimitInfo(response) : undefined;
        
        const categorized = errorService.categorize(rawError, rateLimitInfo);
        return {
          success: false,
          error: categorized.userMessage,
          errorDetails: categorized,
        };
      }
      
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      const categorized = errorService.categorize(error);
      return {
        success: false,
        error: categorized.userMessage,
        errorDetails: categorized,
      };
    }
  },

  async post<T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<APIResponse<T>> {
    try {
      const baseUrl = await getAPIBaseURL();
      if (!baseUrl) {
        return {
          success: false,
          error: "API not configured. Please configure your API in settings.",
        };
      }

      const url = `${baseUrl}${endpoint}`;
      logger.debug('API', `POST ${url}`);
      logger.debug('API', `Request body:`, body);
      
      const response = await fetch(url, {
        method: "POST",
        headers: await createHeaders(),
        body: JSON.stringify(body),
        signal,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        const rawError = errorData.error?.message || `HTTP ${response.status}`;
        
        // Extract rate limit headers for 429 errors
        const rateLimitInfo = response.status === 429 ? extractRateLimitInfo(response) : undefined;
        
        const categorized = errorService.categorize(rawError, rateLimitInfo);
        return {
          success: false,
          error: categorized.userMessage,
          errorDetails: categorized,
        };
      }
      
      const data = await response.json();
      logger.debug('API', `Response from ${endpoint}:`, { 
        hasData: !!data, 
        keys: data ? Object.keys(data) : [],
        firstChoice: data?.choices?.[0]?.message?.content?.substring(0, 100)
      });
      return { success: true, data };
    } catch (error) {
      const categorized = errorService.categorize(error);
      return {
        success: false,
        error: categorized.userMessage,
        errorDetails: categorized,
      };
    }
  },

  async postFormData<T>(endpoint: string, formData: FormData): Promise<APIResponse<T>> {
    try {
      const baseUrl = await getAPIBaseURL();
      if (!baseUrl) {
        return {
          success: false,
          error: "API not configured. Please configure your API in settings.",
        };
      }

      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: "POST",
        headers: await createHeaders(false), // Don't set Content-Type for FormData
        body: formData,
      });
      
      if (!response.ok) {
        const errorData = await response.json();
        const rawError = errorData.error?.message || `HTTP ${response.status}`;
        
        // Extract rate limit headers for 429 errors
        const rateLimitInfo = response.status === 429 ? extractRateLimitInfo(response) : undefined;
        
        const categorized = errorService.categorize(rawError, rateLimitInfo);
        return {
          success: false,
          error: categorized.userMessage,
          errorDetails: categorized,
        };
      }
      
      const data = await response.json();
      return { success: true, data };
    } catch (error) {
      const categorized = errorService.categorize(error);
      return {
        success: false,
        error: categorized.userMessage,
        errorDetails: categorized,
      };
    }
  },

  async postStream(endpoint: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const baseUrl = await getAPIBaseURL();
    if (!baseUrl) {
      throw new Error("API not configured. Please configure your API in settings.");
    }

    const headers = await createHeaders() as Record<string, string>;
    // IMPORTANT: Set accept header for streaming if it's a chat completion
    if (endpoint.includes('/chat/completions')) {
      headers["Accept"] = "text/event-stream";
    }
    
    logger.debug('API', `POST stream ${baseUrl}${endpoint}`, { 
      hasAcceptHeader: headers["Accept"] === "text/event-stream",
      bodyKeys: Object.keys(body as object)
    });

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
      const rawError = errorData.error?.message || `HTTP ${response.status}`;
      
      // Extract rate limit headers for 429 errors
      const rateLimitInfo = response.status === 429 ? extractRateLimitInfo(response) : undefined;
      
      const categorized = errorService.categorize(rawError, rateLimitInfo);
      throw new Error(categorized.userMessage);
    }
    
    return response; // Return raw response for streaming
  },

  async postBinary(endpoint: string, body: unknown, signal?: AbortSignal): Promise<Response> {
    const baseUrl = await getAPIBaseURL();
    if (!baseUrl) {
      throw new Error("API not configured. Please configure your API in settings.");
    }

    const headers = await createHeaders() as Record<string, string>;
    // For binary, we explicitly DON'T want text/event-stream
    // Some providers might want audio/mpeg or similar, but generic POST is safer
    
    logger.debug('API', `POST binary ${baseUrl}${endpoint}`, { 
      bodyKeys: Object.keys(body as object)
    });

    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal,
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: { message: `HTTP ${response.status}` } }));
      const rawError = errorData.error?.message || `HTTP ${response.status}`;
      const categorized = errorService.categorize(rawError);
      throw new Error(categorized.userMessage);
    }
    
    return response;
  },

  async checkHealth(): Promise<boolean> {
    try {
      const endpoints = await apiManager.getEndpoints();
      if (!endpoints.health) {
        return false;
      }

      // Health check should not require authentication
      const response = await fetch(endpoints.health, {
        headers: {
          "Content-Type": "application/json",
        },
      });
      if (!response.ok) return false;
      
      const data = await response.json();
      return data.status === "ok";
    } catch {
      return false;
    }
  },
};
