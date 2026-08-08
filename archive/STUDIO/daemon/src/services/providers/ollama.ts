import { LocalProvider } from './base';
import { LocalModel, LocalProviderRequest, ChatCompletionResponse } from '../../types/index';
import { OLLAMA_BASE_URL, DAEMON_TIMEOUTS } from '../../config/constants';
import { logger } from '../../config/logger';

interface OllamaModel {
  name: string;
  model: string;
  size: number;
  digest: string;
  modified_at: string;
  details?: {
    parameter_size?: string;
    quantization_level?: string;
    family?: string;
    families?: string[];
    [key: string]: any;
  };
}

export class OllamaProvider extends LocalProvider {
  name = 'ollama';
  baseUrl = OLLAMA_BASE_URL;

  async isAvailable(): Promise<boolean> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
        DAEMON_TIMEOUTS.PROVIDER_CHECK
      );
      return response.ok;
    } catch (error) {
      logger.debug('OllamaProvider', 'isAvailable check failed', error);
      return false;
    }
  }

  async discover(): Promise<LocalModel[]> {
    try {
      const response = await this.fetchWithTimeout(
        `${this.baseUrl}/api/tags`,
        { method: 'GET', headers: { 'Content-Type': 'application/json' } },
        DAEMON_TIMEOUTS.MODEL_DISCOVERY
      );

      if (!response.ok) {
        logger.warn('OllamaProvider', `discover failed with status ${response.status}`);
        return [];
      }

      const data: { models: OllamaModel[] } = await response.json();
      const models: LocalModel[] = [];

      for (const model of data.models || []) {
        models.push({
          id: `local:ollama:${model.name}`,
          name: model.name,
          provider: 'ollama',
          size: model.size,
          details: model.details,
        });
      }

      logger.info('OllamaProvider', `Discovered ${models.length} models`);
      return models;
    } catch (error) {
      logger.error('OllamaProvider', 'discover failed', error);
      return [];
    }
  }

  async chat(req: LocalProviderRequest): Promise<ChatCompletionResponse> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.extractModelId(req.model),
          messages: req.messages,
          tools: req.tools || [],
          stream: false,
          temperature: req.temperature ?? 0.7,
          top_p: req.top_p ?? 1,
          ...(req.max_tokens && { max_tokens: req.max_tokens }),
        }),
      },
      DAEMON_TIMEOUTS.CHAT_COMPLETION
    );

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    return response.json() as Promise<ChatCompletionResponse>;
  }

  async streamChat(req: LocalProviderRequest): Promise<ReadableStream<Uint8Array>> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.extractModelId(req.model),
          messages: req.messages,
          tools: req.tools || [],
          stream: true,
          temperature: req.temperature ?? 0.7,
          top_p: req.top_p ?? 1,
          ...(req.max_tokens && { max_tokens: req.max_tokens }),
        }),
      },
      DAEMON_TIMEOUTS.CHAT_COMPLETION
    );

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body');
    }

    return response.body as ReadableStream<Uint8Array>;
  }

  private extractModelId(fullModelId: string): string {
    // "local:ollama:gemma4:e2b" → "gemma4:e2b"
    const withProvider = fullModelId.match(/^local:ollama:(.+)$/);
    if (withProvider) return withProvider[1];
    // "local:gemma4:e2b" → "gemma4:e2b"  (legacy format)
    const legacy = fullModelId.match(/^local:(.+)$/);
    if (legacy) return legacy[1];
    return fullModelId;
  }
}
