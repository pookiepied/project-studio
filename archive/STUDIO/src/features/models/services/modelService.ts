import { APIResponse } from "@/types";
import { convertOllamaToModel } from "./localModelDetection";
import { handleNetworkFailure } from "@/core/network/fallbackService";
import * as ollamaService from "./ollamaService";
import * as parakeetService from "@/features/transcription/services/parakeet";
import { CURATED_EDGE_TTS_VOICES, modelFromVoiceId } from "@/features/tts/local";
import { logger } from "@/core/logging/logger";
import { isFeatureEnabled } from "@/core/platform/featureManager";
import { CACHE_CONFIG, STORAGE_KEYS } from "@/core/config/constants";
import type { Model, ModelsResponse, ProviderInfo } from "@/core/models/types";

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
 * Fetch all available models from API + local Ollama models + Parakeet
 * @param forceRefresh - If true, bypass cache and fetch fresh data
 * @param includeOllama - If true, include Ollama models (default: true)
 * @param includeParakeet - If true, include the local Parakeet transcription model (default: true)
 * @param includeEdgeTts - If true, include the local Edge TTS voices (default: true)
 */
export async function fetchModels(
  forceRefresh: boolean = false,
  includeOllama: boolean = true,
  includeParakeet: boolean = true,
  includeEdgeTts: boolean = true
): Promise<APIResponse<ModelsResponse>> {
  logger.debug('Models', `fetchModels called - forceRefresh: ${forceRefresh}, includeOllama: ${includeOllama}, includeParakeet: ${includeParakeet}, includeEdgeTts: ${includeEdgeTts}`);

  // Override feature flags based on platform capabilities
  const actualIncludeOllama = includeOllama && isFeatureEnabled('ollamaIntegration');
  const actualIncludeParakeet = includeParakeet && isFeatureEnabled('parakeet');
  const actualIncludeEdgeTts = includeEdgeTts && isFeatureEnabled('edgeTts');

  if (includeOllama && !actualIncludeOllama) {
    logger.debug('Models', 'Ollama integration disabled by feature manager');
  }

  if (includeParakeet && !actualIncludeParakeet) {
    logger.debug('Models', 'Parakeet disabled by feature manager');
  }

  if (includeEdgeTts && !actualIncludeEdgeTts) {
    logger.debug('Models', 'Edge TTS disabled by feature manager');
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

  // Local Parakeet transcription model — a fixed, known-in-advance catalog
  // (exactly one model), so this is a hardcoded entry, not a live fetch like
  // Ollama's. Shown as soon as "Enable Parakeet-TDT" is on in Local Services,
  // independent of whether the venv/model download has finished — picking it
  // before it's actually installed just surfaces a clear "not installed yet"
  // error on first use (see transcriptionService.ts), same as picking an
  // Ollama model while the daemon is down.
  if (actualIncludeParakeet) {
    const parakeetModels = [{
      id: `parakeet:${parakeetService.MODEL_NAME}`,
      provider: "parakeet",
      type: "audio" as const,
      name: "Parakeet-TDT 0.6B",
      description: "Local speech-to-text — English + ~25 European languages",
      free: true, // Local models are always free
      capabilities: ["transcription"],
    }];

    allModels = [...allModels, ...parakeetModels];

    providers = {
      ...providers,
      parakeet: {
        provider: "parakeet",
        status: "active",
        lastChecked: new Date().toISOString(),
        apiKeyValid: true, // No API key needed for local
        modelCount: parakeetModels.length,
      } as ProviderInfo,
    };

    logger.debug('Models', 'Added local Parakeet model');
  }

  // Local Edge TTS voices — also a fixed, hardcoded catalog (see voices.ts),
  // shown as soon as "Enable Edge TTS" is on. Note this isn't local inference
  // (see edgeTts/local's own docs) — it's a local client for a free
  // Microsoft cloud voice service, so it needs internet at synthesis time.
  if (actualIncludeEdgeTts) {
    const edgeTtsModels = CURATED_EDGE_TTS_VOICES.map((voice) => ({
      id: modelFromVoiceId(voice.id),
      provider: "edge-tts",
      type: "tts" as const,
      name: voice.label,
      description: "Free multilingual text-to-speech via Microsoft Edge (requires internet)",
      free: true,
      capabilities: ["speech"],
    }));

    allModels = [...allModels, ...edgeTtsModels];

    providers = {
      ...providers,
      "edge-tts": {
        provider: "edge-tts",
        status: "active",
        lastChecked: new Date().toISOString(),
        apiKeyValid: true,
        modelCount: edgeTtsModels.length,
      } as ProviderInfo,
    };

    logger.debug('Models', `Added ${edgeTtsModels.length} Edge TTS voices`);
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
  parakeet: 7,
  "edge-tts": 8,
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

