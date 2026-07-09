import { APIResponse } from "@/types";
import { convertOllamaToModel } from "./localModelDetection";
import { safeGetContextWindow, handleNetworkFailure } from "@/core/network/fallbackService";
import * as ollamaService from "./ollamaService";
import * as fasterWhisperService from "@/features/transcription/services/fasterWhisper";
import { logger } from "@/core/logging/logger";
import { isFeatureEnabled } from "@/core/platform/featureManager";
import { CACHE_CONFIG, STORAGE_KEYS } from "@/core/config/constants";

export interface Model {
  id: string;
  provider: string;
  type: "audio" | "chat" | "embedding" | "image" | "multimodal" | "tts" | "video";
  name: string;
  description?: string;
  maxTokens?: number;
  contextWindow?: number;
  pricing?: {
    input: number;
    output: number;
    currency?: string;
  };
  free?: boolean;
  rateLimit?: {
    rpm: number;
    rpd: number;
  };
  availableFrom?: string[];
  primarySource?: string;
  alternativeSources?: string[];
  capabilities?: string[];
  modality?: string[];
  architecture?: string;
  created?: number;
  // Enhanced metadata for better model understanding
  supportsVision?: boolean;
  supportsTools?: boolean;
  supportsStreaming?: boolean;
  supportsSystemPrompts?: boolean;
  inputTypes?: ("text" | "image" | "audio" | "video")[];
  outputTypes?: ("text" | "image" | "audio" | "video")[];
  maxImageSize?: number; // in MB
  maxImages?: number; // per request
  languages?: string[]; // supported languages
  specialFeatures?: ("thinking" | "reasoning" | "code" | "math" | "creative")[];
}

export interface ProviderInfo {
  provider: string;
  status: "active" | "inactive" | "error";
  lastChecked: string;
  apiKeyValid: boolean;
  modelCount: number;
  errorMessage?: string;
}

export interface ModelsResponse {
  models: Model[];
  providers: Record<string, ProviderInfo>;
  lastUpdated: string;
  totalModels: number;
  uniqueModels: number;
}

// Cache for models
let modelsCache: ModelsResponse | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = CACHE_CONFIG.MODELS_CACHE_DURATION;
const CACHE_STORAGE_KEY = STORAGE_KEYS.MODELS_CACHE;
const CACHE_TIMESTAMP_KEY = STORAGE_KEYS.MODELS_CACHE_TIMESTAMP;

/**
 * Load cache from localStorage
 */
function loadCacheFromStorage(): void {
  try {
    const cachedData = localStorage.getItem(CACHE_STORAGE_KEY);
    const cachedTimestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY);
    
    if (cachedData && cachedTimestamp) {
      const timestamp = parseInt(cachedTimestamp, 10);
      if (Date.now() - timestamp < CACHE_DURATION) {
        modelsCache = JSON.parse(cachedData);
        cacheTimestamp = timestamp;
        logger.debug('Models', 'Loaded models from localStorage cache');
      }
    }
  } catch (error) {
    logger.warn('Models', 'Failed to load cache from localStorage', error);
  }
}

/**
 * Save cache to localStorage
 */
function saveCacheToStorage(data: ModelsResponse): void {
  try {
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(data));
    localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString());
    logger.debug('Models', 'Saved models to localStorage cache');
  } catch (error) {
    logger.warn('Models', 'Failed to save cache to localStorage', error);
  }
}

// Load cache on module initialization
loadCacheFromStorage();


/**
 * Fetch all available models from API + local Ollama models + Faster Whisper models
 * @param forceRefresh - If true, bypass cache and fetch fresh data
 * @param includeOllama - If true, include Ollama models (default: true)
 * @param includeFasterWhisper - If true, include Faster Whisper models (default: true)
 */
export async function fetchModels(
  forceRefresh: boolean = false,
  includeOllama: boolean = true,
  includeFasterWhisper: boolean = true
): Promise<APIResponse<ModelsResponse>> {
  logger.debug('Models', `fetchModels called - forceRefresh: ${forceRefresh}, includeOllama: ${includeOllama}, includeFasterWhisper: ${includeFasterWhisper}`);
  
  // Override feature flags based on platform capabilities
  const actualIncludeOllama = includeOllama && isFeatureEnabled('ollamaIntegration');
  const actualIncludeFasterWhisper = includeFasterWhisper && isFeatureEnabled('fasterWhisper');
  
  if (includeOllama && !actualIncludeOllama) {
    logger.debug('Models', 'Ollama integration disabled by feature manager');
  }
  
  if (includeFasterWhisper && !actualIncludeFasterWhisper) {
    logger.debug('Models', 'Faster Whisper disabled by feature manager');
  }
  // Check cache first (unless force refresh)
  if (!forceRefresh && modelsCache && Date.now() - cacheTimestamp < CACHE_DURATION) {
    logger.debug('Models', 'Using cached data');
    // If cache exists but we need to filter Ollama models
    if (!includeOllama && modelsCache) {
      const filteredModels = modelsCache.models.filter(m => m.provider !== "local");
      const filteredProviders = { ...modelsCache.providers };
      delete filteredProviders.local;
      
      return {
        success: true,
        data: {
          ...modelsCache,
          models: filteredModels,
          providers: filteredProviders,
          totalModels: filteredModels.length,
        },
      };
    }
    
    return {
      success: true,
      data: modelsCache,
    };
  }

  logger.debug('Models', 'Fetching fresh data...');
  
  const { apiManager } = await import("@/core/network/apiManager");
  const config = await apiManager.getConfig();
  
  let cloudResponse: APIResponse<ModelsResponse>;
  
  if (!config.baseUrl) {
    logger.debug('Models', 'No API configured, using local models only');
    // No API configured - use empty cloud response
    cloudResponse = {
      success: true,
      data: {
        models: [],
        providers: {},
        lastUpdated: new Date().toISOString(),
        totalModels: 0,
        uniqueModels: 0,
      }
    };
  } else {
    // API is configured - fetch from full endpoint URL
    try {
      const endpoints = await apiManager.getEndpoints();
      logger.debug('Models', `Fetching from: ${endpoints.models}`);
      
      // Use full endpoint URL directly
      const token = await (await import("@/lib/tokenManager")).tokenManager.getAccessToken();
      const headers: HeadersInit = {
        'Content-Type': 'application/json'
      };
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
      
      const response = await fetch(endpoints.models, { headers });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      cloudResponse = { success: true, data };
      
      logger.debug('Models', `Cloud API response: SUCCESS - ${data.uniqueModels} models`);
    } catch (error) {
      logger.error('Models', 'Cloud API error', error);
      const networkFailure = handleNetworkFailure(error);
      if (networkFailure.isNetworkError) {
        logger.warn('Models', 'Network failure, using local models only');
        // Continue with empty cloud response to use local models
        cloudResponse = {
          success: true,
          data: {
            models: [],
            providers: {},
            lastUpdated: new Date().toISOString(),
            totalModels: 0,
            uniqueModels: 0,
          }
        };
      } else {
        return {
          success: false,
          error: networkFailure.userMessage,
        };
      }
    }
  }

  if (!cloudResponse.success || !cloudResponse.data) {
    // If cloud fetch fails, try to use cached data or local models only
    if (modelsCache) {
      logger.warn('Models', 'Cloud fetch failed, using cached data');
      return { success: true, data: modelsCache };
    }
    
    logger.warn('Models', 'Cloud fetch failed, using local models only');
    cloudResponse = {
      success: true,
      data: {
        models: [],
        providers: {},
        lastUpdated: new Date().toISOString(),
        totalModels: 0,
        uniqueModels: 0,
      }
    };
  }
  
  if (!cloudResponse.data) {
    return {
      success: false,
      error: "No data received from cloud service",
      data: {
        models: [],
        providers: {},
        lastUpdated: new Date().toISOString(),
        totalModels: 0,
        uniqueModels: 0,
      }
    };
  }

  let allModels = [...cloudResponse.data.models];
  let providers = { ...cloudResponse.data.providers };
  let localModels: Model[] = [];

  // Fetch local Ollama models if enabled
  if (actualIncludeOllama) {
    try {
      const ollamaStatus = await ollamaService.checkOllamaStatus();
      
      // Only include if Ollama is actually running AND has models
      if (ollamaStatus.isRunning && ollamaStatus.models.length > 0) {
        // Filter out cloud models (very small size < 1MB = config files only)
        // Real local models are at least 1GB+ (typically 2GB minimum)
        // Cloud models from Ollama are just tiny config files (382-384 bytes)
        const MIN_LOCAL_MODEL_SIZE = 1024 * 1024; // 1MB threshold
        const localOllamaModels = ollamaStatus.models.filter(m => {
          const isLocal = m.size > MIN_LOCAL_MODEL_SIZE;
          if (!isLocal) {
            logger.debug('Models', `Filtering out cloud model: ${m.name} (${m.size} bytes)`);
          }
          return isLocal;
        });
        
        // Only add provider if we have actual local models
        if (localOllamaModels.length > 0) {
          // Convert Ollama models to our Model format with proper capability detection
          localModels = localOllamaModels.map(ollamaModel => convertOllamaToModel(ollamaModel));

          allModels = [...cloudResponse.data.models, ...localModels];

          // Add local provider info
          providers = {
            ...cloudResponse.data.providers,
            local: {
              provider: "local",
              status: "active",
              lastChecked: new Date().toISOString(),
              apiKeyValid: true, // No API key needed for local
              modelCount: localModels.length,
            } as ProviderInfo,
          };
          
          logger.debug('Models', `Added ${localModels.length} local Ollama models`);
        } else {
          logger.debug('Models', 'No local models found (all models are cloud configs)');
        }
      }
      // If Ollama not running or no local models, don't add provider at all
    } catch (error) {
      logger.warn('Models', 'Failed to fetch Ollama models', error);
      // Continue without Ollama models - don't show provider
    }
  }

  // Fetch local Faster Whisper models if enabled
  if (actualIncludeFasterWhisper) {
    try {
      const fwConfig = await fasterWhisperService.loadConfig();
      
      // Only include if Faster Whisper is installed and has models
      if (fwConfig.installed && fwConfig.installedModels.length > 0) {
        // Convert Faster Whisper models to our Model format
        const fasterWhisperModels = fwConfig.installedModels.map(modelName => {
          const metadata = fasterWhisperService.getModelById(modelName);
          return {
            id: `faster-whisper:${modelName}`,
            provider: "faster-whisper",
            type: "audio" as const,
            name: modelName,
            description: metadata?.description || `Local Faster Whisper model`,
            free: true, // Local models are always free
            capabilities: ["transcription", "translation"],
          };
        });

        allModels = [...allModels, ...fasterWhisperModels];

        // Add faster-whisper provider info
        providers = {
          ...providers,
          "faster-whisper": {
            provider: "faster-whisper",
            status: "active",
            lastChecked: new Date().toISOString(),
            apiKeyValid: true, // No API key needed for local
            modelCount: fasterWhisperModels.length,
          } as ProviderInfo,
        };
        
        logger.debug('Models', `Added ${fasterWhisperModels.length} Faster Whisper models`);
      }
    } catch (error) {
      logger.warn('Models', 'Failed to fetch Faster Whisper models', error);
      // Continue without Faster Whisper models
    }
  }
  const mergedResponse: ModelsResponse = {
    models: allModels,
    providers,
    lastUpdated: cloudResponse.data.lastUpdated,
    totalModels: allModels.length,
    uniqueModels: cloudResponse.data.uniqueModels + localModels.length,
  };


  // Update cache
  modelsCache = mergedResponse;
  cacheTimestamp = Date.now();
  saveCacheToStorage(mergedResponse);

  return {
    success: true,
    data: mergedResponse,
  };
}

/**
 * Get models by type
 */
export function getModelsByType(models: Model[], type: Model["type"]): Model[] {
  return models.filter((model) => model.type === type);
}

/**
 * Get chat models (includes both chat and multimodal models)
 */
export function getChatModels(models: Model[]): Model[] {
  return models.filter((model) => model.type === "chat" || model.type === "multimodal");
}

/**
 * Get audio/transcription models
 */
export function getAudioModels(models: Model[]): Model[] {
  return getModelsByType(models, "audio");
}

/**
 * Get image generation models
 */
export function getImageModels(models: Model[]): Model[] {
  return getModelsByType(models, "image");
}

/**
 * Get video generation models
 */
export function getVideoModels(models: Model[]): Model[] {
  return getModelsByType(models, "video");
}

/**
 * Get free models
 */
export function getFreeModels(models: Model[]): Model[] {
  return models.filter((model) => model.free === true);
}

/**
 * Get models by provider
 */
export function getModelsByProvider(models: Model[], provider: string): Model[] {
  return models.filter((model) => model.provider === provider);
}

/**
 * Group models by provider
 */
export function groupModelsByProvider(models: Model[]): Record<string, Model[]> {
  return models.reduce((acc, model) => {
    if (!acc[model.provider]) {
      acc[model.provider] = [];
    }
    acc[model.provider].push(model);
    return acc;
  }, {} as Record<string, Model[]>);
}

// Provider display priority (lower = appears first)
const PROVIDER_PRIORITY: Record<string, number> = {
  groq: 0,       // Fast, has free models
  google: 1,     // Free flash models
  alibaba: 2,    // Free qwen models
  minimax: 3,    // TTS voices
  openrouter: 4, // Largest catalog
  openai: 5,
  anthropic: 6,
  "faster-whisper": 7,
  local: 99,     // Always last
};

function getProviderPriority(provider: string): number {
  return PROVIDER_PRIORITY[provider] ?? 50;
}

/**
 * Sort models: free first, then by context window (desc), then by name
 */
export function sortModels(models: Model[]): Model[] {
  return [...models].sort((a, b) => {
    if (a.free && !b.free) return -1;
    if (!a.free && b.free) return 1;
    // Larger context window first
    const ctxA = a.contextWindow ?? 0;
    const ctxB = b.contextWindow ?? 0;
    if (ctxB !== ctxA) return ctxB - ctxA;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Sort providers by priority order (groq → google → alibaba → openrouter → …), local always last
 */
export function sortProvidersByFree(
  modelsByProvider: Record<string, Model[]>
): [string, Model[]][] {
  return Object.entries(modelsByProvider).sort(
    ([providerA], [providerB]) => getProviderPriority(providerA) - getProviderPriority(providerB)
  );
}

/**
 * Get model by ID from models array
 */
export function getModelById(models: Model[], id: string): Model | undefined {
  return models.find((model) => model.id === id);
}

/**
 * Get context window size for a model
 * Returns the context window in tokens, or a default value if not available
 */
export function getModelContextWindow(models: Model[], modelId: string): number {
  return safeGetContextWindow(models, modelId);
}

/**
 * Calculate maximum tokens allowed for attachments
 * Reserves space for conversation history and AI response
 * 
 * @param contextWindow - Total context window size in tokens
 * @param reserveForConversation - Percentage to reserve for conversation (0-1)
 * @param reserveForResponse - Percentage to reserve for AI response (0-1)
 * @returns Maximum tokens allowed for attachments
 */
export function calculateMaxAttachmentTokens(
  contextWindow: number,
  reserveForConversation: number = 0.3,
  reserveForResponse: number = 0.2
): number {
  // Reserve space for conversation history and response
  const availableForAttachments = 1 - reserveForConversation - reserveForResponse;
  const maxTokens = Math.floor(contextWindow * availableForAttachments);
  
  // Ensure we have at least 1000 tokens for attachments
  return Math.max(maxTokens, 1000);
}

/**
 * Clear models cache (useful for testing or forcing refresh)
 */
export function clearModelsCache(): void {
  modelsCache = null;
  cacheTimestamp = 0;
  try {
    localStorage.removeItem(CACHE_STORAGE_KEY);
    localStorage.removeItem(CACHE_TIMESTAMP_KEY);
    logger.debug('Models', 'Cleared models cache');
  } catch (error) {
    logger.warn('Models', 'Failed to clear cache from localStorage', error);
  }
}

/**
 * Check if models cache is valid
 */
export function isCacheValid(): boolean {
  return modelsCache !== null && Date.now() - cacheTimestamp < CACHE_DURATION;
}

// Model ID migrations (old format -> new format)
// Used to migrate user settings from old non-namespaced format to new provider:model format
const MODEL_MIGRATIONS: Record<string, string> = {
  "whisper-large-v3-turbo": "groq:whisper-large-v3-turbo",
  "whisper-large-v3": "groq:whisper-large-v3",
  "llama-3.1-8b-instant": "groq:llama-3.1-8b-instant",
  "llama-3.3-70b-versatile": "groq:llama-3.3-70b-versatile",
  "llama-3.3-70b-specdec": "groq:llama-3.3-70b-specdec",
  "llama-guard-3-8b": "groq:llama-guard-3-8b",
};

/**
 * Migrate old model ID to new namespaced format
 * Used for backward compatibility with old user settings
 */
export function migrateModelId(oldId: string): string {
  // If already namespaced, return as-is
  if (oldId.includes(":")) return oldId;
  
  // Check migration map
  if (MODEL_MIGRATIONS[oldId]) {
    return MODEL_MIGRATIONS[oldId];
  }
  
  // Default to groq for unknown models (legacy behavior)
  return `groq:${oldId}`;
}
