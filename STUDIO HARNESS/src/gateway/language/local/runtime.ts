import {
  createProvider,
  getSupportedThinkingLevels,
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

import { REASONING_LEVELS, type ReasoningLevel } from "../../../contracts/models.js";
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

/**
 * Assumed limits for a user-declared model that states none.
 *
 * Pi derives each request's output budget from the model's record
 * (`clampMaxTokensToContext`: with a non-positive context window the budget
 * collapses to a single token), so a record must never carry 0 for "we do
 * not know". These assumptions apply only at this boundary: the catalog
 * keeps recording unknown honestly, and anything the user states — per
 * model or per connection — wins over them. An assumption that overshoots
 * a small local model surfaces as the server's own length or context
 * error, which names the real problem; a 0 surfaced as a one-token reply
 * naming nothing.
 */
export const ASSUMED_CUSTOM_CONTEXT_WINDOW = 128_000;
export const ASSUMED_CUSTOM_MAX_TOKENS = 8_192;

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
  return config.models.map((entry) => ({
    id: entry.id,
    name: entry.id,
    api: config.api,
    provider: config.id,
    baseUrl: config.baseUrl,
    // The model's own declaration decides. An undeclared model stays
    // non-reasoning rather than advertising a capability nobody verified.
    reasoning: entry.reasoningLevels.length > 0,
    input: ["text"],
    cost: ZERO_COST,
    contextWindow:
      entry.contextWindow ?? config.contextWindow ?? ASSUMED_CUSTOM_CONTEXT_WINDOW,
    maxTokens: entry.maxTokens ?? config.maxTokens ?? ASSUMED_CUSTOM_MAX_TOKENS,
  }));
}

export interface LocalRuntime {
  readonly models: MutableModels;
  /** The model the stable alias routes to, or undefined when misconfigured. */
  target(): Model<Api> | undefined;
  listModels(): readonly Model<Api>[];
  /**
   * The reasoning levels one stored reference supports, in Pi's order, empty
   * for a model that does not reason.
   *
   * Synchronous because the agent render is synchronous: it reads the same Pi
   * collection `applyOpenRouterDefaultReasoning` mutates, so the answer agrees
   * with the request path. Null is the stable alias and resolves through the
   * configured target. An unknown reference answers medium, which keeps the
   * request on the explicit path; only a known non-reasoning model answers
   * empty.
   */
  supportedReasoningLevels(modelId: string | null): readonly ReasoningLevel[];
}

/**
 * The reasoning levels one Pi model supports, in this contract's vocabulary.
 *
 * Pi's own `getSupportedThinkingLevels` minus "off", filtered to the levels
 * this contract names. A model that cannot reason answers empty, so the dial
 * can be absent rather than present and inert.
 */
function reasoningLevelsForPiModel(model: Model<Api>): readonly ReasoningLevel[] {
  const known = new Set<string>(REASONING_LEVELS);
  return getSupportedThinkingLevels(model).filter(
    (level): level is ReasoningLevel => level !== "off" && known.has(level),
  );
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

  const targetFor = (): Model<Api> | undefined =>
    options.config.defaultProvider === undefined ||
    options.config.defaultModel === undefined
      ? undefined
      : models.getModel(options.config.defaultProvider, options.config.defaultModel);

  return {
    models,
    // An unselected default is a state, not a fault: `undefined` here is what
    // makes the alias descriptor report unconfigured and the settings UI's
    // fix-it path reachable, instead of the harness refusing to start.
    target: targetFor,
    listModels: () => models.getModels(),
    supportedReasoningLevels: (modelId) => supportedLevelsForReference(models, targetFor, modelId),
  };
}

/**
 * Resolves one stored reference to its supported levels without touching the
 * keychain or the network.
 *
 * The reference is in the local runtime's own `<provider>/<model>` vocabulary;
 * model ids themselves may contain slashes, so the split is on the first one
 * only. Unknown references answer medium rather than empty: empty would send
 * silence, which is the behaviour this task removes, while medium keeps the
 * request on the explicit path Pi clamps per model.
 */
function supportedLevelsForReference(
  models: MutableModels,
  target: () => Model<Api> | undefined,
  modelId: string | null,
): readonly ReasoningLevel[] {
  if (modelId === null) {
    const resolved = target();
    // The alias resolves to nothing when no default is configured, and also
    // when a configured default names a model the collection no longer has.
    // Both are "this reference is unknown", not "this model does not reason",
    // and answering empty here would send the silence this task removed. Only
    // a model that resolved and reports no levels answers empty.
    if (resolved === undefined) return ["medium"];
    return reasoningLevelsForPiModel(resolved);
  }
  const separator = modelId.indexOf("/");
  if (separator <= 0 || separator === modelId.length - 1) return ["medium"];
  const provider = modelId.slice(0, separator);
  const id = modelId.slice(separator + 1);
  const model = models.getModel(provider, id);
  if (model === undefined) return ["medium"];
  return reasoningLevelsForPiModel(model);
}

/**
 * Builds the Pi collection without requiring a default model.
 *
 * Provider management needs this: a user connects a provider *before* choosing
 * a default model, so the connect flow cannot depend on one already being set.
 */
function createModelsCollection(options: {
  readonly customProviders: readonly CustomProviderConfig[];
  readonly extraModels?: readonly ExtraProviderModelGroup[];
  readonly credentials: CredentialStore;
}): MutableModels {
  const models = builtinModels({ credentials: options.credentials });

  // Pi 1.x renamed Azure's provider, but stored selections and keychain
  // entries still name the old id. An alias keeps both usable without
  // rewriting user data; a custom provider below can still replace it.
  const azure = models.getProvider("azure");
  if (azure !== undefined) {
    models.setProvider({
      id: "azure-openai-responses",
      name: azure.name,
      auth: azure.auth,
      getModels: () => azure.getModels().map((model) => ({ ...model, provider: "azure-openai-responses" })),
      stream: azure.stream.bind(azure),
      streamSimple: azure.streamSimple.bind(azure),
    });
  }

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
      api: group.api,
      provider: group.provider,
      baseUrl: group.baseUrl,
      // The user's own word about reasoning; the levels they chose are what
      // the request then asks for, rendered per protocol by pi-ai.
      reasoning: model.reasoningLevels.length > 0,
      input: ["text"],
      cost: ZERO_COST,
      contextWindow: model.contextWindow ?? ASSUMED_CUSTOM_CONTEXT_WINDOW,
      maxTokens: model.maxTokens ?? ASSUMED_CUSTOM_MAX_TOKENS,
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
