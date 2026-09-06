import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  ModelCost,
  ProviderStreams,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { createProvider } from "@earendil-works/pi-ai";
import { setProvider } from "@flue/runtime";

import {
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  ModelResolutionError,
  ProviderConfigurationError,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type ModelReference,
  type ReasoningLevel,
} from "../../contracts/models.js";
import {
  defaultAliasDescriptor,
  descriptorFromPiModel,
} from "../local/catalog.js";
import type { LocalRuntime } from "../local/runtime.js";
import type { LocalModelConfig } from "../local/config.js";
import { tracePrompt } from "../prompt-trace.js";

/** Pi wire-protocol slug standing in for "whatever the user's model speaks". */
export const LOCAL_ALIAS_API = "project-studio-local";

export interface LocalModelProviderAdapterOptions {
  readonly config: LocalModelConfig;
  readonly runtime: LocalRuntime;
}

/**
 * Auth that answers configured while promising nothing.
 *
 * The Flue runtime refuses to stream through a provider it cannot resolve
 * auth for, and the alias provider this adapter registers is resolved by the
 * runtime's Models collection before anything of ours runs. The alias sends
 * nothing itself - it delegates one layer down, where the real target
 * provider's own auth resolves the user's key through the Studio credential
 * bridge - so the honest answer is "configured, with no credential": an empty
 * auth injects no key, no header and no environment into the request. The
 * same shape pi-ai's own faux provider uses for its scripted stream.
 */
const ALIAS_AUTH = {
  apiKey: {
    name: "Project Studio model alias",
    async resolve() {
      return { auth: {} };
    },
  },
};

/** Zero rates for the placeholder entry that stands in for an unset default. */
const UNPRICED: ModelCost = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

/**
 * The `default` entry registered when no target is configured.
 *
 * An unconfigured default is a state, not a fault: the entry exists so the
 * alias RESOLVES - the turn then fails in `assertTargetResolvable`, which
 * names what to fix - and its zero facts are never read, because nothing
 * streams through it.
 */
const UNCONFIGURED_DEFAULT_ENTRY: Model<Api> = {
  id: DEFAULT_MODEL_NAME,
  name: DEFAULT_MODEL_NAME,
  api: LOCAL_ALIAS_API,
  provider: DEFAULT_MODEL_PROVIDER,
  baseUrl: "",
  reasoning: false,
  input: ["text"],
  cost: UNPRICED,
  contextWindow: 0,
  maxTokens: 0,
};

/**
 * Local BYOK model source.
 *
 * The agent only ever names `project-studio/default`, so this adapter is the
 * seam between that alias and the Pi model the user actually configured:
 * under Flue 2.0 it registers ONE provider with the runtime (`setProvider`,
 * id `project-studio`) whose model list mirrors the local runtime's catalog -
 * the stable `default` plus every model under its qualified
 * `<provider>/<model>` id - and whose API implementation is an alias router:
 * it resolves the real target out of the model id the run asked for and
 * delegates to it through the local runtime's own Models collection, where
 * credentials, OAuth refresh and `streamSimple`'s protocol translation all
 * live. Delegating to Pi is deliberate, and so is routing the delegation
 * through our collection rather than registering real providers directly:
 * Pi's Models collection owns credential resolution, and the runtime's
 * collection carries no credentials of ours.
 *
 * The user's keys never pass through this file. They live in the OS keychain
 * and are read by Pi during auth resolution.
 */
export class LocalModelProviderAdapter implements ModelProviderAdapter {
  readonly source = "local" as const;
  readonly operational = true;

  readonly #config: LocalModelConfig;
  readonly #runtime: LocalRuntime;

  constructor(options: LocalModelProviderAdapterOptions) {
    this.#config = options.config;
    this.#runtime = options.runtime;
  }

  /**
   * Mounts the alias provider with the Flue runtime.
   *
   * The runtime resolves a model specifier by splitting it on the first
   * slash, so every specifier this source can honour - `project-studio`
   * followed by the qualified reference or the alias - resolves against this
   * one registration. The model objects mirror the real catalog's facts
   * (context window, cost, reasoning, vision) so the runtime reads honest
   * metadata, while their `api` is the alias router: the wire rendering
   * happens one delegation down, on the real model record.
   *
   * Idempotent by replacement: the runtime keys providers by id, and a
   * second registration with the same id replaces the first.
   */
  register(): void {
    // No `this` alias: these are arrow functions, so they close over the
    // instance already, and the alias only hid that they do.
    const aliasApi: ProviderStreams = {
      stream: (model, context, options) => this.#streamAlias(model, context, options),
      streamSimple: (model, context, options) => this.#streamAlias(model, context, options),
    };
    setProvider(
      createProvider({
        id: DEFAULT_MODEL_PROVIDER,
        name: "Project Studio local models",
        auth: ALIAS_AUTH,
        models: this.#aliasModels(),
        api: aliasApi,
      }),
    );
  }

  /**
   * The model objects the runtime's specifier resolution reads.
   *
   * `default` is the stable route to the configured target; every catalog
   * model rides under its qualified `<provider>/<model>` id, which is exactly
   * the reference vocabulary the conversation index stores. Built once at
   * registration from the same collection the runs delegate into, so the two
   * can never disagree about what exists.
   */
  #aliasModels(): readonly Model<Api>[] {
    const target = this.#runtime.target();
    const defaultEntry =
      target === undefined ? UNCONFIGURED_DEFAULT_ENTRY : this.#aliasEntry(target, DEFAULT_MODEL_NAME);
    return [
      defaultEntry,
      ...this.#runtime.listModels().map((model) =>
        this.#aliasEntry(model, `${model.provider}/${model.id}`),
      ),
    ];
  }

  /** One catalog model, re-addressed under the studio alias provider. */
  #aliasEntry(model: Model<Api>, id: string): Model<Api> {
    return {
      id,
      name: model.name,
      api: LOCAL_ALIAS_API,
      provider: DEFAULT_MODEL_PROVIDER,
      baseUrl: model.baseUrl,
      reasoning: model.reasoning,
      input: model.input,
      cost: model.cost,
      contextWindow: model.contextWindow,
      maxTokens: model.maxTokens,
    };
  }

  /**
   * The delegation itself: resolve the target, trace it, hand the request to
   * the real provider through the local runtime's collection.
   *
   * `streamSimple`, not `stream`, on the far side: the options crossing this
   * boundary are protocol-independent, because the alias is not a real wire
   * protocol and nothing upstream knows which one the target speaks. Only
   * `streamSimple` translates them - `reasoning` becomes Google's
   * `thinkingConfig` or OpenAI's `reasoning_effort` there. `stream` takes
   * options already in the target's protocol and silently ignores anything
   * else, which is how every model reasoned invisibly once: the request
   * never asked for the trace.
   */
  #streamAlias(
    alias: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream {
    const target = this.#resolveTarget(alias);
    // The last point the request is ours. Off unless STUDIO_PROMPT_TRACE=1.
    tracePrompt(`${target.provider}/${target.id}`, context, options);
    return this.#runtime.models.streamSimple(target, context, options);
  }

  /**
   * Fails loudly when a turn cannot be routed, rather than at the first user
   * message with nothing said. Two distinct refusals: no model has been chosen
   * yet, which the settings UI exists to fix, or a chosen model that cannot be
   * found, which is a configuration error naming what to check.
   */
  assertTargetResolvable(): Model<Api> {
    const target = this.#runtime.target();
    if (target) return target;

    if (this.#config.defaultProvider === undefined || this.#config.defaultModel === undefined) {
      throw new ProviderConfigurationError(
        'No default model is selected. Choose one in provider settings, or set PROJECT_STUDIO_LOCAL_DEFAULT_MODEL to "<provider>/<model>".',
      );
    }
    throw new ProviderConfigurationError(
      `Local default model "${this.#config.defaultProvider}/${this.#config.defaultModel}" is not available. Check the provider id and model id, and declare the provider in PROJECT_STUDIO_LOCAL_PROVIDERS if it is not built in.`,
    );
  }

  resolve(reference: ModelReference): ModelDescriptor {
    if (reference.source !== this.source) {
      throw new ModelResolutionError(
        `Model source "${reference.source}" does not match the "${this.source}" adapter.`,
      );
    }
    if (reference.provider !== DEFAULT_MODEL_PROVIDER) {
      throw new ModelResolutionError(
        `Unknown provider "${reference.provider}" for source "${this.source}".`,
      );
    }

    if (reference.model === DEFAULT_MODEL_NAME) {
      return defaultAliasDescriptor(this.#runtime.target());
    }

    const separator = reference.model.indexOf("/");
    if (separator <= 0) {
      throw new ModelResolutionError(
        `Local model "${reference.model}" must be written as "<provider>/<model>".`,
      );
    }

    const model = this.#runtime.models.getModel(
      reference.model.slice(0, separator),
      reference.model.slice(separator + 1),
    );
    if (!model) {
      throw new ModelResolutionError(
        `Unknown model "${reference.model}" for source "${this.source}".`,
      );
    }
    return descriptorFromPiModel(model);
  }

  listModels(): readonly ModelDescriptor[] {
    return [
      defaultAliasDescriptor(this.#runtime.target()),
      ...this.#runtime.listModels().map(descriptorFromPiModel),
    ];
  }

  supportedReasoningLevels(modelId: string | null): readonly ReasoningLevel[] {
    return this.#runtime.supportedReasoningLevels(modelId);
  }

  /**
   * The cheapest model this source can honestly reach, priced from Pi's own
   * listed rates.
   *
   * Candidates are the models whose providers actually hold credentials
   * (`getAvailable`), so a model this harness cannot pay for is never
   * proposed. Cost is the sum of the input and output rates - a background
   * job's request is a few hundred tokens in and a few words out, and both
   * rates are per token in Pi, so their sum orders models the same way any
   * real mix of the two would. Zero-cost endpoints - loopback servers,
   * gateways' free tiers - sort first, which is exactly right: a model that
   * genuinely costs nothing should name the conversation.
   *
   * Rates below zero are not prices and rank as nothing: gateways encode
   * "cost unknown until a router picks" as a negative rate, and a policy
   * whose whole job is bounding the spend cannot be bounded by one. The
   * first call names the cheapest candidate; `skip` names a later rank, so
   * a caller whose first pick failed can step down the ladder without this
   * layer learning why.
   */
  async backgroundModel(skip = 0): Promise<string | undefined> {
    return (await this.#rankedBackgroundSpecifiers())[skip];
  }

  /** The ladder snapshot, computed by `refreshBackgroundLadder` and read as-is. */
  #backgroundLadder: readonly string[] = [];

  backgroundLadder(): readonly string[] {
    return this.#backgroundLadder;
  }

  /**
   * Recomputes the ladder from live availability, one sweep of the same
   * ranking `backgroundModel` answers from - one keychain read covers every
   * rank, so a snapshot and a per-rank query cost the same.
   */
  async refreshBackgroundLadder(): Promise<void> {
    this.#backgroundLadder = await this.#rankedBackgroundSpecifiers();
  }

  async #rankedBackgroundSpecifiers(): Promise<readonly string[]> {
    const available = await this.#runtime.models.getAvailable();
    const ranked = [...available]
      .filter((model) => model.cost.input + model.cost.output >= 0)
      .sort(
        (a, b) =>
          a.cost.input +
          a.cost.output -
          (b.cost.input + b.cost.output),
      );
    return ranked.map(
      (model) => `${DEFAULT_MODEL_PROVIDER}/${model.provider}/${model.id}`,
    );
  }

  /**
   * Returns the models whose providers actually have credentials configured.
   * This is what a settings surface should show as connected, and it is why the
   * credential store is injected into Pi rather than consulted here.
   */
  async listAvailableModels(): Promise<readonly ModelDescriptor[]> {
    const available = await this.#runtime.models.getAvailable();
    return available.map(descriptorFromPiModel);
  }

  /** Refreshes providers that publish a dynamic model list. */
  async refreshModels(signal?: AbortSignal): Promise<void> {
    await this.#runtime.models.refresh(signal ? { signal } : undefined);
  }

  readonly stream = (
    alias: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    // The incoming model is the alias placeholder; the real one comes from
    // configuration, or - when the conversation's run named one - from the
    // alias's own id, which carries the `<provider>/<model>` reference the
    // conversation index stores. Delegation hands Pi the model and the auth
    // for it.
    const target = this.#resolveTarget(alias);
    // The last point the request is ours. Off unless STUDIO_PROMPT_TRACE=1.
    tracePrompt(`${target.provider}/${target.id}`, context, options);
    // `streamSimple`, not `stream`: the options crossing this boundary are
    // protocol-independent, because the alias is not a real wire protocol and
    // nothing upstream knows which one the target speaks. Only `streamSimple`
    // translates them — `reasoning` becomes Google's `thinkingConfig` or
    // OpenAI's `reasoning_effort` there. `stream` takes options already in the
    // target's protocol and silently ignores anything else, which is how every
    // model reasoned invisibly: the request never asked for the trace.
    return this.#runtime.models.streamSimple(target, context, options);
  };

  /**
   * The model a request actually goes to.
   *
   * The alias's `default` id is the stable route to the configured default.
   * Anything else is a reference a conversation settled on, and it is honoured
   * exactly or not at all: falling back to the default here would be the
   * picker changing nothing about the request, wearing a quieter shape. An
   * unresolvable reference is a configuration error naming what to check.
   */
  #resolveTarget(alias: Model<Api>): Model<Api> {
    if (alias.id === DEFAULT_MODEL_NAME) {
      return this.assertTargetResolvable();
    }

    const separator = alias.id.indexOf("/");
    if (separator <= 0) {
      throw new ProviderConfigurationError(
        `The conversation's model "${alias.id}" is not a "<provider>/<model>" reference.`,
      );
    }
    const target = this.#runtime.models.getModel(
      alias.id.slice(0, separator),
      alias.id.slice(separator + 1),
    );
    if (!target) {
      throw new ProviderConfigurationError(
        `The conversation's model "${alias.id}" is not available. Connect its provider or pick another model.`,
      );
    }
    return target;
  }
}
