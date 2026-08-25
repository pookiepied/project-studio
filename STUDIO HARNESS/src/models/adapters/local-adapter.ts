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
    _model: Model<Api>,
    context: Context,
    options?: SimpleStreamOptions,
  ): AssistantMessageEventStream => {
    // The incoming model is the alias placeholder; the real one comes from
    // configuration. Delegation hands Pi both the model and the auth for it.
    const target = this.assertTargetResolvable();
    return this.#runtime.models.stream(target, context, options);
  };
}
