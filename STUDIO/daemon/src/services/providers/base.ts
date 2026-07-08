import { LocalModel, LocalProviderRequest, ChatCompletionResponse } from '../../types/index';

export abstract class LocalProvider {
  abstract name: string;
  abstract baseUrl: string;

  abstract discover(): Promise<LocalModel[]>;
  abstract isAvailable(): Promise<boolean>;
  abstract chat(req: LocalProviderRequest): Promise<ChatCompletionResponse>;
  abstract streamChat(req: LocalProviderRequest): Promise<ReadableStream<Uint8Array>>;

  protected async fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
