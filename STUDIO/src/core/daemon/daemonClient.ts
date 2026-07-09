/**
 * Daemon HTTP Client
 * Communicates with the local provider daemon running at localhost:localProviderPort
 */

import { logger } from '../logging/logger';

export interface DaemonHealth {
  running: boolean;
  port: number;
  providers: {
    ollama: boolean;
    lmstudio: boolean;
  };
  models: number;
  uptime: number;
}

export interface LocalModel {
  id: string;
  name: string;
  provider: 'ollama' | 'lmstudio';
  size?: number;
  details?: Record<string, any>;
}

export interface DaemonModelsResponse {
  data: LocalModel[];
  object: string;
  count: number;
}

export class DaemonClient {
  private baseUrl: string;

  constructor(port: number = 11435) {
    this.baseUrl = `http://localhost:${port}`;
  }

  async checkHealth(): Promise<DaemonHealth> {
    const response = await fetch(`${this.baseUrl}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }

    return (await response.json()) as DaemonHealth;
  }

  async fetchModels(forceRefresh: boolean = false): Promise<LocalModel[]> {
    const query = forceRefresh ? '?refresh=true' : '';
    const response = await fetch(`${this.baseUrl}/v1/models${query}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch models: ${response.statusText}`);
    }

    const data = (await response.json()) as DaemonModelsResponse;
    logger.info('DaemonClient', `Fetched ${data.count} models`);
    return data.data;
  }

  async executeChat(request: {
    model: string;
    messages: any[];
    tools?: any[];
    stream?: boolean;
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
  }): Promise<Response> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      throw new Error(`Chat execution failed: ${response.statusText}`);
    }

    return response;
  }

  async streamChat(request: {
    model: string;
    messages: any[];
    tools?: any[];
    temperature?: number;
    top_p?: number;
    max_tokens?: number;
  }): Promise<ReadableStream<string>> {
    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...request, stream: true }),
    });

    if (!response.ok) {
      throw new Error(`Stream execution failed: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('No response body for stream');
    }

    return response.body as unknown as ReadableStream<string>;
  }
}

export const createDaemonClient = (port: number = 11435): DaemonClient => {
  return new DaemonClient(port);
};
