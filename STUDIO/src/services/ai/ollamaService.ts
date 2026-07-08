/**
 * Ollama Local LLM Service
 * Direct connection to local Ollama instance (bypasses Cloudflare API)
 * 
 * Ollama provides OpenAI-compatible API at http://localhost:11434/v1
 * This allows us to reuse most of our existing chat logic!
 */

import { APIResponse } from '../../types';
import { logger } from '../logging/logger';
import { errorService } from '../errors/errorService';

function getOllamaBaseUrl(baseUrl?: string): string {
  return baseUrl || 'http://localhost:11434';
}

export interface OllamaModel {
  name: string;
  model: string;
  modified_at: string;
  size: number;
  digest: string;
  details: {
    parent_model?: string;
    format?: string;
    family?: string;
    families?: string[];
    parameter_size?: string;
    quantization_level?: string;
  };
}

export interface OllamaStatus {
  isRunning: boolean;
  isAvailable: boolean;
  version?: string;
  models: OllamaModel[];
}

/**
 * Check if Ollama is running and accessible
 */
export async function checkOllamaStatus(): Promise<OllamaStatus> {
  try {
    // Check if Ollama is running by hitting the tags endpoint
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      return {
        isRunning: false,
        isAvailable: false,
        models: [],
      };
    }

    const data = await response.json();
    
    return {
      isRunning: true,
      isAvailable: true,
      models: data.models || [],
    };
  } catch (error) {
    logger.debug('Ollama', 'Not running or not accessible', error);
    return {
      isRunning: false,
      isAvailable: false,
      models: [],
    };
  }
}

/**
 * Get list of available Ollama models
 */
export async function getOllamaModels(): Promise<APIResponse<OllamaModel[]>> {
  try {
    const response = await fetch(`${getOllamaBaseUrl()}/api/tags`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      const categorized = errorService.categorize('Failed to fetch Ollama models. Is Ollama running?');
      return {
        success: false,
        error: categorized.userMessage,
        errorDetails: categorized,
      };
    }

    const data = await response.json();
    return {
      success: true,
      data: data.models || [],
    };
  } catch (error) {
    const categorized = errorService.categorize(error);
    return {
      success: false,
      error: categorized.userMessage,
      errorDetails: categorized,
    };
  }
}

