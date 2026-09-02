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
import type {
  CustomProviderConfig,
  ExtraProviderModelGroup,
  LocalModelConfig,
} from "./config.js";

/** Env var a custom provider's key may come from, e.g. `ollama` -> `OLLAMA_API_KEY`. */
export function customProviderEnvVar(id: string): string {
  return `${id.replace(/-/g, "_").toUpperCase()}_API_KEY`;
}

/**
 * The Pi provider id whose reasoning models route through OpenRouter's own
 * reasoning object.
 */
const OPENROUTER_PROVIDER = "openrouter";

/**
 * "No explicit effort requested" must reach OpenRouter as silence.
 *
 * The OpenRouter request format injects `reasoning: { effort: "none" }` when
 * a reasoning model is asked without an explicit level, and effort "none" is
 * not silence - it is a request to think not at all. A person whose reasoning
 * choice is "default" (the dial's resting state) asked for the provider's own
 * behaviour, and got reasoning switched off instead. The deferred fix, long
 * named and never taken while pi-ai was off limits, is pi-ai's own opt-out:
 * a model whose `thinkingLevelMap.off` is `null` makes the format layer send
 * no reasoning parameter at all. Applied here, at the one place this harness
 * composes Pi's catalog, to every OpenRouter reasoning model; a model record
 * that already maps other levels keeps them. Task 38 measured the wire shape
 * this corrects; `runThinkingLevelForChoice` documents the full protocol
 * picture.
 */
function applyOpenRouterDefaultReasoning(models: MutableModels): void {
  for (const model of models.getModels(OPENROUTER_PROVIDER)) {
    if (!model.reasoning) continue;
    model.thinkingLevelMap = { ...model.thinkingLevelMap, off: null };
  }
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
    extraModels: options.config.extraModels,
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
  readonly extraModels?: readonly ExtraProviderModelGroup[];
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

  for (const group of options.extraModels ?? []) {
    const load = API_LOADERS[group.api];
    if (!load || group.models.length === 0) continue;

    // The user's hand-entered models join the vendor's own catalog rather
    // than replacing it: re-registering the provider with only the extras
    // would make every built-in model of that vendor vanish from the runtime.
    const existing = models.getProvider(group.provider);
    const extraModels: readonly Model<Api>[] = group.models.map((model) => ({
      id: model.id,
      name: model.name,
      api: group.api as Api,
      provider: group.provider,
      baseUrl: group.baseUrl,
      // The user's own word about reasoning; the levels they chose are what
      // the request then asks for, rendered per protocol by pi-ai.
      reasoning: model.reasoningLevels.length > 0,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: model.contextWindow ?? 0,
      maxTokens: model.maxTokens ?? 0,
    }));

    models.setProvider(
      createProvider({
        id: group.provider,
        name: existing?.name ?? group.provider,
        baseUrl: existing?.baseUrl ?? group.baseUrl,
        auth:
          existing?.auth ??
          // No built-in provider to inherit auth from: the same auth shape a
          // self-hosted provider gets, resolving the credential by the
          // vendor's own id through the credential store.
          {
            apiKey: customProviderAuth({
              id: group.provider,
              name: group.provider,
              baseUrl: group.baseUrl,
              api: group.api,
              models: [],
              contextWindow: undefined,
              maxTokens: undefined,
            }),
          },
        models: [...(existing?.getModels() ?? []), ...extraModels],
        api: lazyApi(load),
      }),
    );
  }

  // After every setProvider above, so the extras' rebuilt providers are
  // covered too - the fix edits the model records the catalog holds.
  applyOpenRouterDefaultReasoning(models);

  return models;
}
