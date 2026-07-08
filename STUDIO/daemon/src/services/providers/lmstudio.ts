import { LocalProvider } from './base';
import { LocalModel, LocalProviderRequest, ChatCompletionResponse } from '../../types/index';
import { LM_STUDIO_BASE_URL, DAEMON_TIMEOUTS } from '../../config/constants';
import { logger } from '../../config/logger';

interface LMStudioModel {
  id?: string;
  key?: string;
  display_name?: string;
  object?: string;
  owned_by?: string;
  loaded_instances?: Array<{
    id?: string;
  }>;
}

interface LMStudioModelsPayload {
  data?: LMStudioModel[];
  models?: LMStudioModel[];
}

interface ParsedModelsPayload {
  models: LMStudioModel[];
  recognized: boolean;
}

export class LMStudioProvider extends LocalProvider {
  name = 'lmstudio';
  baseUrl = LM_STUDIO_BASE_URL;

  private readonly modelEndpoints = ['/api/v1/models', '/v1/models'];
  private readonly chatEndpoints = ['/v1/chat/completions', '/api/v1/chat/completions', '/api/v1/chat'];

  private buildUrl(endpoint: string): string {
    const base = this.baseUrl.replace(/\/+$/, '');
    return `${base}${endpoint}`;
  }

  private parseModelsPayload(payload: unknown): ParsedModelsPayload {
    if (Array.isArray(payload)) {
      return { models: payload as LMStudioModel[], recognized: true };
    }

    const typedPayload = payload as LMStudioModelsPayload;
    if (Array.isArray(typedPayload?.data)) {
      return { models: typedPayload.data, recognized: true };
    }

    if (Array.isArray(typedPayload?.models)) {
      return { models: typedPayload.models, recognized: true };
    }

    return { models: [], recognized: false };
  }

  private normalizeModelId(model: LMStudioModel): string | null {
    if (typeof model.id === 'string' && model.id.trim().length > 0) {
      return model.id;
    }

    if (typeof model.key === 'string' && model.key.trim().length > 0) {
      return model.key;
    }

    const loadedId = model.loaded_instances?.find((instance) => typeof instance.id === 'string' && instance.id.trim().length > 0)?.id;
    if (loadedId) {
      return loadedId;
    }

    if (typeof model.display_name === 'string' && model.display_name.trim().length > 0) {
      return model.display_name;
    }

    return null;
  }

  async isAvailable(): Promise<boolean> {
    for (const endpoint of this.modelEndpoints) {
      try {
        const response = await this.fetchWithTimeout(
          this.buildUrl(endpoint),
          { method: 'GET', headers: { 'Content-Type': 'application/json' } },
          DAEMON_TIMEOUTS.PROVIDER_CHECK
        );

        if (!response.ok) {
          continue;
        }

        const payload = await response.json();
        const parsed = this.parseModelsPayload(payload);
        if (parsed.recognized) {
          return true;
        }
      } catch (error) {
        logger.debug('LMStudioProvider', `isAvailable check failed for ${endpoint}`, error);
      }
    }

    return false;
  }

  async discover(): Promise<LocalModel[]> {
    let sawRecognizedModelsPayload = false;

    for (const endpoint of this.modelEndpoints) {
      try {
        const response = await this.fetchWithTimeout(
          this.buildUrl(endpoint),
          { method: 'GET', headers: { 'Content-Type': 'application/json' } },
          DAEMON_TIMEOUTS.MODEL_DISCOVERY
        );

        if (!response.ok) {
          logger.warn('LMStudioProvider', `discover failed for ${endpoint} with status ${response.status}`);
          continue;
        }

        const payload = await response.json();
        const parsed = this.parseModelsPayload(payload);
        if (!parsed.recognized) {
          logger.warn('LMStudioProvider', `Unrecognized models payload from ${endpoint}`);
          continue;
        }

        sawRecognizedModelsPayload = true;

        const discovered = parsed.models;
        const models: LocalModel[] = [];

        for (const model of discovered) {
          const modelId = this.normalizeModelId(model);
          if (!modelId) {
            continue;
          }

          models.push({
            id: `local:lmstudio:${modelId}`,
            name: `${model.display_name ?? modelId} (LM Studio)`,
            provider: 'lmstudio',
          });
        }

        logger.info('LMStudioProvider', `Discovered ${models.length} models via ${endpoint}`);
        if (models.length > 0) {
          return models;
        }
      } catch (error) {
        logger.error('LMStudioProvider', `discover failed for ${endpoint}`, error);
      }
    }

    if (sawRecognizedModelsPayload) {
      logger.info('LMStudioProvider', 'No LM Studio models discovered from recognized endpoint payload');
    }

    return [];
  }

  private async requestChat(
    req: LocalProviderRequest,
    stream: boolean
  ): Promise<Response> {
    let lastError: Error | undefined;

    for (const endpoint of this.chatEndpoints) {
      try {
        const response = await this.fetchWithTimeout(
          this.buildUrl(endpoint),
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: this.extractModelId(req.model),
              messages: req.messages,
              tools: req.tools || [],
              stream,
              temperature: req.temperature ?? 0.7,
              top_p: req.top_p ?? 1,
              ...(req.max_tokens && { max_tokens: req.max_tokens }),
            }),
          },
          DAEMON_TIMEOUTS.CHAT_COMPLETION
        );

        if (response.ok) {
          return response;
        }

        lastError = new Error(`LM Studio API error at ${endpoint}: ${response.status} ${response.statusText}`);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    throw lastError ?? new Error('LM Studio API request failed');
  }

  async chat(req: LocalProviderRequest): Promise<ChatCompletionResponse> {
    const response = await this.requestChat(req, false);

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.statusText}`);
    }

    return response.json() as Promise<ChatCompletionResponse>;
  }

  async streamChat(req: LocalProviderRequest): Promise<ReadableStream<Uint8Array>> {
    const response = await this.requestChat(req, true);

    if (!response.ok) {
      throw new Error(`LM Studio API error: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    return response.body as ReadableStream<Uint8Array>;
  }

  private extractModelId(fullModelId: string): string {
    // "local:lmstudio:phi-3" → "phi-3"
    const withProvider = fullModelId.match(/^local:lmstudio:(.+)$/);
    if (withProvider) return withProvider[1];
    // "local:modelname" → "modelname"  (legacy format)
    const legacy = fullModelId.match(/^local:(.+)$/);
    if (legacy) return legacy[1];
    return fullModelId;
  }
}
