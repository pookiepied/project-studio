import {
  createProvider,
  lazyApi,
  type Api,
  type ApiKeyAuth,
  type ApiKeyCredential,
  type AuthResult,
  type CredentialStore,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";

import { API_LOADERS } from "./apis.js";
import type { CustomProviderConfig, LocalModelConfig } from "./config.js";

/** Env var a custom provider's key may come from, e.g. `ollama` -> `OLLAMA_API_KEY`. */
export function customProviderEnvVar(id: string): string {
  return `${id.replace(/-/g, "_").toUpperCase()}_API_KEY`;
}

const ZERO_COST = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Stand-in credential for keyless local servers.
 *
 * Pi's OpenAI-compatible implementation refuses to send a request with no API
 * key, but Ollama and LM Studio require none and ignore the header entirely.
 * A placeholder satisfies the protocol without pretending to be a secret. It is
 * used only for loopback endpoints: a remote provider configured without a key
 * should fail with Pi's own "no API key" error rather than send a meaningless
 * token over the network.
 */
export const LOCAL_PLACEHOLDER_KEY = "project-studio-local";

function isLoopback(baseUrl: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(baseUrl).hostname);
  } catch {
    return false;
  }
}

/**
 * Auth for a user-declared provider.
 *
 * A stored key wins, then the provider's environment variable, then the
 * loopback placeholder. Reporting a keyless local server as unconfigured would
 * hide models that work perfectly well.
 */
function customProviderAuth(config: CustomProviderConfig): ApiKeyAuth {
  const envVar = customProviderEnvVar(config.id);
  const loopback = isLoopback(config.baseUrl);

  return {
    name: `${config.name} API key`,
    async login(interaction) {
      const key = await interaction.prompt({
        type: "secret",
        message: `${config.name} API key`,
      });
      const credential: ApiKeyCredential = { type: "api_key", key };
      return credential;
    },
    async resolve({ ctx, credential }): Promise<AuthResult | undefined> {
      const stored = credential?.key;
      if (stored) return { auth: { apiKey: stored }, source: "stored key" };

      const fromEnv = await ctx.env(envVar);
      if (fromEnv) return { auth: { apiKey: fromEnv }, source: envVar };

      if (loopback) {
        return {
          auth: { apiKey: LOCAL_PLACEHOLDER_KEY },
          source: "local server, no credential required",
        };
      }
      return undefined;
    },
  };
}

function customProviderModels(
  config: CustomProviderConfig,
): readonly Model<Api>[] {
  return config.models.map((id) => ({
    id,
    name: id,
    api: config.api as Api,
    provider: config.id,
    baseUrl: config.baseUrl,
    // Unknown for a user-declared endpoint. Claiming reasoning or vision here
    // would advertise capabilities the harness cannot verify.
    reasoning: false,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow: config.contextWindow ?? 0,
    maxTokens: config.maxTokens ?? 0,
  }));
}

export interface LocalRuntime {
  readonly models: MutableModels;
  /** The model the stable alias routes to, or undefined when misconfigured. */
  target(): Model<Api> | undefined;
  listModels(): readonly Model<Api>[];
}

export interface CreateLocalRuntimeOptions {
  readonly config: LocalModelConfig;
  readonly credentials: CredentialStore;
}

/**
 * Builds the Pi model collection backing the local source.
 *
 * Pi owns provider auth resolution, OAuth refresh, and dynamic model lists;
 * Project Studio supplies only the credential store and the user's custom
 * providers. That division is why local BYOK needs no per-provider code: the
 * built-in providers arrive with the package, and anything else is
 * configuration over a known wire protocol.
 */
export function createLocalRuntime(
  options: CreateLocalRuntimeOptions,
): LocalRuntime {
  const models = createModelsCollection({
    customProviders: options.config.customProviders,
    credentials: options.credentials,
  });

  return {
    models,
    // An unselected default is a state, not a fault: `undefined` here is what
    // makes the alias descriptor report unconfigured and the settings UI's
    // fix-it path reachable, instead of the harness refusing to start.
    target: () =>
      options.config.defaultProvider === undefined ||
      options.config.defaultModel === undefined
        ? undefined
        : models.getModel(
            options.config.defaultProvider,
            options.config.defaultModel,
          ),
    listModels: () => models.getModels(),
  };
}

/**
 * Builds the Pi collection without requiring a default model.
 *
 * Provider management needs this: a user connects a provider *before* choosing
 * a default model, so the connect flow cannot depend on one already being set.
 */
export function createModelsCollection(options: {
  readonly customProviders: readonly CustomProviderConfig[];
  readonly credentials: CredentialStore;
}): MutableModels {
  const models = builtinModels({ credentials: options.credentials });

  for (const custom of options.customProviders) {
    const load = API_LOADERS[custom.api];
    if (!load) continue;

    models.setProvider(
      createProvider({
        id: custom.id,
        name: custom.name,
        baseUrl: custom.baseUrl,
        auth: { apiKey: customProviderAuth(custom) },
        models: customProviderModels(custom),
        api: lazyApi(load),
      }),
    );
  }

  return models;
}
