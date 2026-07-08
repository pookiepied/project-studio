import { OllamaProvider } from './providers/ollama';
import { LMStudioProvider } from './providers/lmstudio';
import { LocalModel } from '../types/index';
import { logger } from '../config/logger';

export class LocalModelRegistry {
  private providers = [new OllamaProvider(), new LMStudioProvider()];
  private cachedModels: LocalModel[] = [];
  private lastRefreshTime = 0;
  private readonly CACHE_TTL_MS = 30000;

  async getModels(forceRefresh = false): Promise<LocalModel[]> {
    const now = Date.now();

    if (!forceRefresh && this.cachedModels.length > 0 && now - this.lastRefreshTime < this.CACHE_TTL_MS) {
      return this.cachedModels;
    }

    const allModels: LocalModel[] = [];
    for (const provider of this.providers) {
      try {
        const isAvailable = await provider.isAvailable();
        if (isAvailable) {
          const models = await provider.discover();
          allModels.push(...models);
          logger.info('LocalModelRegistry', `${provider.name}: ${models.length} models`);
        } else {
          logger.debug('LocalModelRegistry', `${provider.name}: not available`);
        }
      } catch (error) {
        logger.error('LocalModelRegistry', `Failed to discover ${provider.name} models`, error);
      }
    }

    this.cachedModels = allModels;
    this.lastRefreshTime = now;
    logger.info('LocalModelRegistry', `Total models: ${allModels.length}`);
    return allModels;
  }

  async getModel(modelId: string): Promise<LocalModel | undefined> {
    const models = await this.getModels();
    return models.find(m => m.id === modelId);
  }

  async getProviderForModel(modelId: string) {
    if (modelId.startsWith('local:ollama:')) {
      return this.providers.find(p => p.name === 'ollama');
    } else if (modelId.startsWith('local:lmstudio:')) {
      return this.providers.find(p => p.name === 'lmstudio');
    }
    // Legacy format: "local:modelname" — default to Ollama
    if (modelId.startsWith('local:')) {
      return this.providers.find(p => p.name === 'ollama');
    }
    return undefined;
  }

  async getProviderStatus() {
    const statuses: Record<string, boolean> = {};
    for (const provider of this.providers) {
      statuses[provider.name] = await provider.isAvailable();
    }
    return statuses;
  }
}

export const modelRegistry = new LocalModelRegistry();
