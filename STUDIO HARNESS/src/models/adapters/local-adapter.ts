import type {
  Api,
  AssistantMessageEventStream,
  Context,
  Model,
  SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { registerApiProvider, registerProvider } from "@flue/runtime";

import {
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  ModelResolutionError,
  ProviderConfigurationError,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type ModelReference,
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
 * Local BYOK model source.
 *
 * The agent only ever names `project-studio/default`, so this adapter registers
 * that alias as its own wire protocol and forwards each request to the Pi model
 * the user actually configured. Delegating to Pi's `Models` collection rather
 * than to a protocol implementation is deliberate: `Models.stream()` resolves
 * credentials, refreshes OAuth tokens under a lock, and dispatches to the
 * provider that owns the model, so none of that has to be reimplemented here.
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

  register(): void {
    registerApiProvider({
      api: LOCAL_ALIAS_API,
      stream: this.stream,
      streamSimple: this.stream,
    });

    const { defaultProvider, defaultModel } = this.#config;

    // An unconfigured source registers only what Flue structurally requires:
    // the alias resolves to its unoperational descriptor, and no telemetry
    // names a provider this harness has never been given.
    if (defaultProvider === undefined || defaultModel === undefined) {
      registerProvider(DEFAULT_MODEL_PROVIDER, {
        api: LOCAL_ALIAS_API,
        baseUrl: "http://127.0.0.1",
      });
      return;
    }

    const target = this.#runtime.target();

    // Flue requires a baseUrl for a provider id its catalog does not know. The
    // target's own endpoint is the honest value, and it is never used to build
    // a request: this adapter delegates before any URL is assembled.
    registerProvider(DEFAULT_MODEL_PROVIDER, {
      api: LOCAL_ALIAS_API,
      baseUrl: target?.baseUrl ?? "http://127.0.0.1",
      ...(target?.contextWindow ? { contextWindow: target.contextWindow } : {}),
      ...(target?.maxTokens ? { maxTokens: target.maxTokens } : {}),
      telemetry: {
        providerName: defaultProvider,
        serverAddress: target?.baseUrl ?? "local",
      },
    });
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
    const available = await this.#runtime.models.getAvailable();
    const ranked = [...available]
      .filter((model) => model.cost.input + model.cost.output >= 0)
      .sort(
        (a, b) =>
          a.cost.input +
          a.cost.output -
          (b.cost.input + b.cost.output),
      );
    const chosen = ranked[skip];
    if (chosen === undefined) return undefined;
    return `${DEFAULT_MODEL_PROVIDER}/${chosen.provider}/${chosen.id}`;
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
