/**
 * Base interfaces for provider discovery
 * All providers implement this to enable dynamic model discovery
 */

import { Model } from "../types";

/**
 * Provider Discovery Interface
 * Every provider (Groq, OpenAI, Google, etc.) implements this
 */
export interface ProviderDiscovery {
  /**
   * Provider name (e.g., "groq", "openai", "google")
   */
  name: string;
  
  /**
   * Discover all models from this provider's API
   * Returns normalized models with proper categorization
   */
  discoverModels(): Promise<Model[]>;
  
}

/**
 * Discovery result from a single provider
 */
export interface ProviderDiscoveryResult {
  provider: string;
  models: Model[];
  status: "success" | "error";
  errorMessage?: string;
  discoveredAt: string;
}

/**
 * Complete discovery result from all providers
 */
export interface DiscoveryResult {
  providers: ProviderDiscoveryResult[];
  totalModels: number;
  byType: {
    chat:      number;
    multimodal: number;
    audio:     number;
    image:     number;
    video:     number;
    tts:       number;
    embedding: number;
  };
  discoveredAt: string;
}
