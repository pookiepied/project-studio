/**
 * Main Discovery Orchestrator
 * Coordinates model discovery from all providers
 */

import { DiscoveryResult, ProviderDiscoveryResult } from "./base";
import { GroqDiscovery } from "./providers/groq";
import { OpenAIDiscovery } from "./providers/openai";
import { GoogleDiscovery } from "./providers/google";
import { OpenRouterDiscovery } from "./providers/openrouter";
import { AlibabaDiscovery } from "./providers/alibaba";
import { AnthropicDiscovery } from "./providers/anthropic";
import { XAIDiscovery } from "./providers/xai";
import { DeepSeekDiscovery } from "./providers/deepseek";
import { MistralDiscovery }  from "./providers/mistral";
import { CohereDiscovery }   from "./providers/cohere";
import { BedrockDiscovery }  from "./providers/bedrock";
import { AzureDiscovery }    from "./providers/azure";
import { MiniMaxDiscovery }  from "./providers/minimax";
import { CloudflareDiscovery } from "./providers/cloudflare";
import { FalDiscovery }       from "./providers/fal";
import { GatewayEnv } from "../env";
import { Model } from "../types";
import { logger } from "../logger";
import { isProviderEnabled } from "../utils/providerUtils";

export class ModelDiscovery {
  private env: GatewayEnv;

  constructor(env: GatewayEnv) {
    this.env = env;
  }

  private checkProviderEnabled(providerName: string): boolean {
    return isProviderEnabled(providerName, this.env.ENABLED_PROVIDERS);
  }

  /**
   * Discover models from all enabled providers
   */
  async discoverAll(): Promise<DiscoveryResult> {
    logger.info("Starting model discovery from all providers");
    const startTime = Date.now();

    const providers: ProviderDiscoveryResult[] = [];
    const allModels: Model[] = [];

    // Discover from each provider
    await Promise.all([
      this.discoverFromProvider("groq", this.env.GROQ_API_KEY, GroqDiscovery),
      this.discoverFromProvider("openai", this.env.OPENAI_API_KEY, OpenAIDiscovery),
      this.discoverFromProvider("google", this.env.GOOGLE_AI_API_KEY, GoogleDiscovery),
      this.discoverFromProvider("openrouter", this.env.OPENROUTER_API_KEY, OpenRouterDiscovery, this.env),
      this.discoverFromProvider("anthropic", this.env.ANTHROPIC_API_KEY, AnthropicDiscovery),
      this.discoverFromProviderWithHost("alibaba", this.env.ALIBABA_API_KEY, this.env.ALIBABA_API_HOST, AlibabaDiscovery),
      this.discoverFromProvider("xai", this.env.XAI_API_KEY, XAIDiscovery),
      this.discoverFromProvider("deepseek", this.env.DEEPSEEK_API_KEY, DeepSeekDiscovery),
      this.discoverFromProvider("mistral",  this.env.MISTRAL_API_KEY, MistralDiscovery),
      this.discoverFromProvider("cohere",   this.env.COHERE_API_KEY,  CohereDiscovery),
      this.discoverBedrock(),
      this.discoverAzure(),
      this.discoverFromProvider("minimax",  this.env.MINIMAX_API_KEY, MiniMaxDiscovery, {
        groupId: this.env.MINIMAX_GROUP_ID,
        customVoiceId: this.env.MINIMAX_CUSTOM_VOICE_ID,
        customVoiceName: this.env.MINIMAX_CUSTOM_VOICE_NAME,
      }),
      // Cloudflare AI is a special case — no API key, gated by the AI binding
      this.discoverCloudflare(),
      // fal.ai — dedicated image/video generation; static catalogue, gated by API key
      this.discoverFal(),
    ]).then(results => {
      for (const result of results) {
        if (result) {
          providers.push(result);
          allModels.push(...result.models);
        }
      }
    });

    // Calculate statistics
    const byType = {
      chat:       0,
      multimodal: 0,
      audio:      0,
      image:      0,
      video:      0,
      tts:        0,
      embedding:  0,
    };

    for (const model of allModels) {
      if (model.type in byType) {
        byType[model.type as keyof typeof byType]++;
      }
    }

    const result: DiscoveryResult = {
      providers,
      totalModels: allModels.length,
      byType,
      discoveredAt: new Date().toISOString()
    };

    const duration = Date.now() - startTime;
    logger.info(
      `Discovery complete: ${allModels.length} models from ${providers.length} providers (${duration}ms)`
    );

    return result;
  }

  /**
   * Discover models from a single provider
   * Checks if provider is enabled and has API key before attempting discovery
   */
  private async discoverFromProvider(
    name: string,
    apiKey: string | undefined,
    DiscoveryClass: any,
    options?: any
  ): Promise<ProviderDiscoveryResult | null> {
    // Check if provider is enabled
    if (!this.checkProviderEnabled(name)) {
      logger.info(`${name}: Skipped (disabled in ENABLED_PROVIDERS)`);
      return null;
    }

    if (!apiKey) {
      logger.info(`${name}: Skipped (no API key)`);
      return null;
    }

    try {
      const discovery = options ? new DiscoveryClass(apiKey, options) : new DiscoveryClass(apiKey);
      const models = await discovery.discoverModels();

      logger.info(`${name}: ${models.length} models`);

      return {
        provider: name,
        models,
        status: "success",
        discoveredAt: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`${name}: ${errorMessage}`);

      return {
        provider: name,
        models: [],
        status: "error",
        errorMessage,
        discoveredAt: new Date().toISOString()
      };
    }
  }

  /**
   * Discover Cloudflare AI models.
   * Cloudflare uses the AI binding (env.AI) instead of an API key, so it
   * needs its own helper rather than going through discoverFromProvider.
   */
  private async discoverCloudflare(): Promise<ProviderDiscoveryResult | null> {
    if (!this.checkProviderEnabled("cloudflare")) {
      logger.info("cloudflare: Skipped (disabled in ENABLED_PROVIDERS)");
      return null;
    }

    try {
      const discovery = new CloudflareDiscovery(!!this.env.AI);
      const models    = await discovery.discoverModels();

      logger.info(`cloudflare: ${models.length} models`);

      return {
        provider:    "cloudflare",
        models,
        status:      "success",
        discoveredAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`cloudflare: ${errorMessage}`);
      return {
        provider:    "cloudflare",
        models:      [],
        status:      "error",
        errorMessage,
        discoveredAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Discover Bedrock models from the static catalogue.
   * No API key check — presence of any AWS credential triggers inclusion.
   */
  private async discoverBedrock(): Promise<ProviderDiscoveryResult | null> {
    if (!this.checkProviderEnabled("bedrock")) {
      logger.info("bedrock: Skipped (disabled in ENABLED_PROVIDERS)");
      return null;
    }
    const hasAuth = !!(
      this.env.AWS_BEARER_TOKEN_BEDROCK ||
      (this.env.AWS_ACCESS_KEY_ID && this.env.AWS_SECRET_ACCESS_KEY)
    );
    if (!hasAuth) {
      logger.info("bedrock: Skipped (no AWS credentials)");
      return null;
    }
    try {
      const discovery = new BedrockDiscovery();
      const models    = await discovery.discoverModels();
      logger.info(`bedrock: ${models.length} models`);
      return { provider: "bedrock", models, status: "success", discoveredAt: new Date().toISOString() };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`bedrock: ${errorMessage}`);
      return { provider: "bedrock", models: [], status: "error", errorMessage, discoveredAt: new Date().toISOString() };
    }
  }

  /**
   * Discover Azure models from the AZURE_DEPLOYMENTS KV-backed map.
   */
  private async discoverAzure(): Promise<ProviderDiscoveryResult | null> {
    if (!this.checkProviderEnabled("azure")) {
      logger.info("azure: Skipped (disabled in ENABLED_PROVIDERS)");
      return null;
    }
    if (!this.env.AZURE_RESOURCE_NAME || !this.env.AZURE_API_KEY) {
      logger.info("azure: Skipped (AZURE_RESOURCE_NAME or AZURE_API_KEY not set)");
      return null;
    }
    try {
      const discovery = new AzureDiscovery(this.env.AZURE_RESOURCE_NAME, this.env.AZURE_DEPLOYMENTS);
      const models    = await discovery.discoverModels();
      logger.info(`azure: ${models.length} deployments`);
      return { provider: "azure", models, status: "success", discoveredAt: new Date().toISOString() };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`azure: ${errorMessage}`);
      return { provider: "azure", models: [], status: "error", errorMessage, discoveredAt: new Date().toISOString() };
    }
  }

  /**
   * Discover fal.ai image and video models.
   * fal.ai uses a static catalogue (no /models API) and is gated by FAL_API_KEY.
   */
  private async discoverFal(): Promise<ProviderDiscoveryResult | null> {
    if (!this.checkProviderEnabled("fal")) {
      logger.info("fal: Skipped (disabled in ENABLED_PROVIDERS)");
      return null;
    }

    try {
      const discovery = new FalDiscovery(!!this.env.FAL_API_KEY);
      const models    = await discovery.discoverModels();

      logger.info(`fal: ${models.length} models`);

      return {
        provider:    "fal",
        models,
        status:      "success",
        discoveredAt: new Date().toISOString(),
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`fal: ${errorMessage}`);
      return {
        provider:    "fal",
        models:      [],
        status:      "error",
        errorMessage,
        discoveredAt: new Date().toISOString(),
      };
    }
  }

  /**
   * Discover models from a provider that needs a custom host
   * Checks if provider is enabled and has API key before attempting discovery
   */
  private async discoverFromProviderWithHost(
    name: string,
    apiKey: string | undefined,
    apiHost: string | undefined,
    DiscoveryClass: any
  ): Promise<ProviderDiscoveryResult | null> {
    // Check if provider is enabled
    if (!this.checkProviderEnabled(name)) {
      logger.info(`${name}: Skipped (disabled in ENABLED_PROVIDERS)`);
      return null;
    }

    if (!apiKey) {
      logger.info(`${name}: Skipped (no API key)`);
      return null;
    }

    try {
      const discovery = new DiscoveryClass(apiKey, apiHost);
      const models = await discovery.discoverModels();

      logger.info(`${name}: ${models.length} models`);

      return {
        provider: name,
        models,
        status: "success",
        discoveredAt: new Date().toISOString()
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      logger.error(`${name}: ${errorMessage}`);

      return {
        provider: name,
        models: [],
        status: "error",
        errorMessage,
        discoveredAt: new Date().toISOString()
      };
    }
  }

}
