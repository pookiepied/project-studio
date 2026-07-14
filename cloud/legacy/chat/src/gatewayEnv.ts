/**
 * Bindings shared between the standalone `studio-gateway` worker and this
 * `studio-chat` worker. Chat's full `Env` (env.ts) extends this type and adds
 * chat-only bindings (CHAT_DB, CHAT_AGENT, ANALYTICS, etc.).
 *
 * `studio-gateway/src/env.ts` re-exports this type so both workers share the
 * exact same structural type — no duplication.
 */
export interface GatewayEnv {
  // LLM provider API keys
  GROQ_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  OPENAI_API_KEY?: string;
  GOOGLE_AI_API_KEY?: string;
  ALIBABA_API_KEY?: string;
  ALIBABA_API_HOST?: string;
  XAI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  MISTRAL_API_KEY?: string;
  COHERE_API_KEY?: string;
  LOCAL_API_KEY?: string;
  LOCAL_BASE_URL?: string;
  MINIMAX_API_KEY?: string;
  MINIMAX_GROUP_ID?: string;
  MINIMAX_API_HOST?: string;
  MINIMAX_CUSTOM_VOICE_ID?: string;
  MINIMAX_CUSTOM_VOICE_NAME?: string;

  // Azure OpenAI
  AZURE_RESOURCE_NAME?: string;
  AZURE_API_KEY?: string;
  AZURE_OPENAI_API_VERSION?: string;
  /** JSON string — maps modelId to Azure deployment name, e.g. {"gpt-4o":"my-gpt4o-deployment"} */
  AZURE_DEPLOYMENTS?: string;

  // Amazon Bedrock
  AWS_REGION?: string;
  AWS_ACCESS_KEY_ID?: string;
  AWS_SECRET_ACCESS_KEY?: string;
  /** Simpler alternative to SigV4 — Bearer token for Bedrock data-plane */
  AWS_BEARER_TOKEN_BEDROCK?: string;

  ENVIRONMENT?: string;
  ENABLED_PROVIDERS?: string;
  /** JSON overrides for per-provider modality enable/disable at runtime */
  PROVIDER_MODALITIES_CONFIG?: string;

  CF_AI_GATEWAY_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_NAME?: string;
  CF_AI_GATEWAY_TOKEN?: string;

  FAL_API_KEY?: string;
  JINA_API_KEY?: string;
  COMPOSIO_API_KEY?: string;
  TAVILY_API_KEY?: string;
  BRAVE_SEARCH_API_KEY?: string;

  OPENROUTER_SITE_URL?: string;
  PUBLIC_API_BASE?: string;
  JWT_SECRET?: string;

  MEMORY_AUTH_SECRET?: string;

  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;

  // KV namespaces
  MODELS_KV: KVNamespace;
  MCP_KV: KVNamespace;
  REVOKED_KV?: KVNamespace;
  CREDITS_KV?: KVNamespace;

  // R2 buckets
  RELEASES_BUCKET: R2Bucket;
  DOCS_BUCKET?: R2Bucket;
  IMAGES_BUCKET?: R2Bucket;
  TEMP_IMAGES_BUCKET?: R2Bucket;

  // Workers AI — embedding model for RAG
  AI?: Ai;

  // Vectorize — semantic search index
  VECTORIZE?: VectorizeIndex;

  // Tracker service binding
  TRACKER?: Fetcher;

  // Analytics Engine — structured error/telemetry events (chat worker only)
  ANALYTICS?: AnalyticsEngineDataset;

  // Auto-router tier model overrides
  TIER_SIMPLE_PRIMARY?: string;
  TIER_SIMPLE_FALLBACK?: string;
  TIER_STANDARD_PRIMARY?: string;
  TIER_STANDARD_FALLBACK?: string;
  TIER_COMPLEX_PRIMARY?: string;
  TIER_COMPLEX_FALLBACK?: string;
  TIER_ADVANCED_PRIMARY?: string;
  TIER_ADVANCED_FALLBACK?: string;
  TIER_EXTREME_PRIMARY?: string;
  TIER_EXTREME_FALLBACK?: string;
  EMERGENCY_FALLBACK_MODEL?: string;
  AUTO_STATIC_MODEL_OVERRIDE?: string;
}
