import * as v from "valibot";
import { StudioError } from "../errors/error.js";
import { ErrorCodes } from "../errors/codes.js";

const providerName = v.pipe(v.string(), v.minLength(1), v.transform((s) => s.trim().toLowerCase()));

const envSchema = v.object({
  TAVILY_API_KEY: v.optional(v.string()),
  JINA_API_KEY: v.optional(v.string()),
  BRAVE_API_KEY: v.optional(v.string()),
  SEARCH_PRIMARY: v.optional(providerName, "tavily"),
  SEARCH_FALLBACK: v.optional(providerName, "brave"),
  FETCH_PRIMARY: v.optional(providerName, "jina"),
  FETCH_FALLBACK: v.optional(providerName, "tavily"),
  MCP_SERVER_NAME: v.optional(v.string(), "studio-web"),
  MCP_SERVER_VERSION: v.optional(v.string(), "0.1.0"),
});

export type WorkerEnv = v.InferOutput<typeof envSchema> & Record<string, string | undefined>;

export interface ProviderConfig {
  readonly searchPrimary: string;
  readonly searchFallback: string;
  readonly fetchPrimary: string;
  readonly fetchFallback: string;
  readonly tavilyKey?: string;
  readonly jinaKey?: string;
  readonly braveKey?: string;
}

export function resolveEnv(raw: Record<string, unknown>): WorkerEnv {
  try {
    return v.parse(envSchema, raw);
  } catch (cause) {
    throw new StudioError(ErrorCodes.CONFIG_MISSING, "Worker environment is invalid.", 500);
  }
}

export function resolveProviderConfig(env: WorkerEnv): ProviderConfig {
  return {
    searchPrimary: (env.SEARCH_PRIMARY ?? "tavily").toLowerCase(),
    searchFallback: (env.SEARCH_FALLBACK ?? "brave").toLowerCase(),
    fetchPrimary: (env.FETCH_PRIMARY ?? "jina").toLowerCase(),
    fetchFallback: (env.FETCH_FALLBACK ?? "tavily").toLowerCase(),
    ...(env.TAVILY_API_KEY ? { tavilyKey: env.TAVILY_API_KEY } : {}),
    ...(env.JINA_API_KEY ? { jinaKey: env.JINA_API_KEY } : {}),
    ...(env.BRAVE_API_KEY ? { braveKey: env.BRAVE_API_KEY } : {}),
  };
}

export function assertProviderConfigured(provider: string, cfg: ProviderConfig): void {
  const needsKey: Record<string, string | undefined> = {
    tavily: cfg.tavilyKey,
    jina: cfg.jinaKey,
    brave: cfg.braveKey,
  };
  if (provider in needsKey && !needsKey[provider]) {
    throw new StudioError(ErrorCodes.PROVIDER_NOT_CONFIGURED, `Provider "${provider}" is not configured (missing API key).`, 500);
  }
}
