import type {
  AuthInteraction,
  AuthPrompt,
  AuthType,
  MutableModels,
} from "@earendil-works/pi-ai";

import { ProviderConfigurationError } from "../../contracts/models.js";
import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import type { ErrorReporter } from "../../observability/error-reporter.js";
import type { CustomProviderConfig, CustomProviderInput } from "./config.js";
import { PiCredentialStore } from "./credential-bridge.js";
import { createModelsCollection, customProviderEnvVar } from "./runtime.js";
import type {
  DefaultModelSelection,
  ProviderSettingsStore,
} from "./settings-store.js";

/**
 * The provider management contract.
 *
 * The CLI drove these flows first; this is the same behavior expressed as
 * something a settings screen can call. The split matters because the answers a
 * settings screen needs — is this connected, where did the credential come
 * from, can the user disconnect it — are not answerable from the keychain
 * alone, which cannot enumerate, nor from the database alone, which does not
 * know about environment variables.
 *
 * No method returns key material, and the one method that accepts a key hands
 * it directly to Pi's login flow without the value touching the harness's own
 * model code.
 */

export type ProviderOrigin = "builtin" | "custom";

export interface ProviderSummary {
  readonly id: string;
  readonly name: string;
  readonly origin: ProviderOrigin;
  /** A usable credential resolves for this provider right now. */
  readonly connected: boolean;
  /** How the credential was supplied, e.g. `stored key` or `OPENAI_API_KEY`. */
  readonly credentialSource: string | undefined;
  readonly authType: AuthType | undefined;
  /** Login methods the provider offers. */
  readonly supportedAuth: readonly AuthType[];
  /**
   * Project Studio stored this credential and can remove it. False for a
   * provider configured through an ambient environment variable — the settings
   * UI should not offer a Disconnect button that would do nothing.
   */
  readonly managed: boolean;
  /** Custom providers only. */
  readonly baseUrl: string | undefined;
  readonly modelCount: number;
}

export interface ProviderModelSummary {
  readonly provider: string;
  readonly model: string;
  /** Provider-qualified id, which is also the default-model specifier. */
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number | undefined;
  readonly maxTokens: number | undefined;
}

export interface LocalProviderServiceOptions {
  readonly settings: ProviderSettingsStore;
  readonly credentials: SecureCredentialStore;
  readonly reporter?: ErrorReporter;
}

/** Answers a single secret prompt with a supplied value and nothing else. */
function apiKeyInteraction(apiKey: string): AuthInteraction {
  return {
    async prompt(prompt: AuthPrompt): Promise<string> {
      if (prompt.type === "secret") return apiKey;
      // A provider needing more than a key cannot be connected
      // non-interactively; failing is better than answering with the key.
      throw new ProviderConfigurationError(
        "This provider needs an interactive login and cannot be connected with an API key alone.",
      );
    },
    notify(): void {},
  };
}

export class LocalProviderService {
  readonly #settings: ProviderSettingsStore;
  readonly #credentials: PiCredentialStore;
  readonly #reporter: ErrorReporter | undefined;
  #models: MutableModels | undefined;

  constructor(options: LocalProviderServiceOptions) {
    this.#settings = options.settings;
    this.#credentials = new PiCredentialStore(options.credentials);
    this.#reporter = options.reporter;
  }

  /** Rebuilt after a custom-provider change, since the collection is built from them. */
  #collection(): MutableModels {
    this.#models ??= createModelsCollection({
      customProviders: this.#settings.listCustomProviders(),
      credentials: this.#credentials,
    });
    return this.#models;
  }

  #invalidate(): void {
    this.#models = undefined;
  }

  async listProviders(): Promise<readonly ProviderSummary[]> {
    const models = this.#collection();
    const custom = new Map(
      this.#settings.listCustomProviders().map((entry) => [entry.id, entry]),
    );
    const managed = new Set(
      this.#settings.listConnections().map((entry) => entry.providerId),
    );

    const summaries: ProviderSummary[] = [];
    for (const provider of models.getProviders()) {
      // A provider that cannot report its auth state is reported as
      // disconnected rather than failing the whole listing: one broken provider
      // must not blank the settings screen.
      const check = await models.checkAuth(provider.id).catch((error: unknown) => {
        this.#reporter?.report(error, {
          operation: "providers.check_auth",
          provider: provider.id,
        });
        return undefined;
      });

      const supportedAuth: AuthType[] = [];
      if (provider.auth.apiKey) supportedAuth.push("api_key");
      if (provider.auth.oauth) supportedAuth.push("oauth");

      summaries.push({
        id: provider.id,
        name: provider.name,
        origin: custom.has(provider.id) ? "custom" : "builtin",
        connected: check !== undefined,
        credentialSource: check?.source,
        authType: check?.type,
        supportedAuth,
        managed: managed.has(provider.id),
        baseUrl: custom.get(provider.id)?.baseUrl ?? provider.baseUrl,
        modelCount: provider.getModels().length,
      });
    }

    return summaries;
  }

  listModels(providerId?: string): readonly ProviderModelSummary[] {
    return this.#collection()
      .getModels(providerId)
      .map((model) => ({
        provider: model.provider,
        model: model.id,
        id: `${model.provider}/${model.id}`,
        name: model.name,
        // Pi uses 0 for "not stated"; a settings UI must not print 0 tokens.
        contextWindow: model.contextWindow > 0 ? model.contextWindow : undefined,
        maxTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
      }));
  }

  /**
   * Stores a provider API key.
   *
   * The key goes to Pi's login flow, which validates it against the provider's
   * own credential shape and writes it through the keychain-backed store. The
   * connection row is written only after that succeeds, so a failed key write
   * never leaves the settings screen claiming a connection exists.
   */
  async connectWithApiKey(providerId: string, apiKey: string): Promise<void> {
    const provider = this.#requireProvider(providerId);
    if (!provider.auth.apiKey?.login) {
      throw new ProviderConfigurationError(
        `Provider "${providerId}" does not accept an API key. ${
          provider.auth.oauth
            ? "Use the sign-in flow instead."
            : `It reads an ambient credential, such as ${customProviderEnvVar(providerId)}.`
        }`,
      );
    }

    await this.#collection().login(providerId, "api_key", apiKeyInteraction(apiKey));
    this.#settings.recordConnection(providerId);
  }

  /** Runs a provider-owned interactive login (OAuth, device code, or prompts). */
  async connectInteractively(
    providerId: string,
    interaction: AuthInteraction,
    type?: AuthType,
  ): Promise<void> {
    const provider = this.#requireProvider(providerId);
    const resolved: AuthType = type ?? (provider.auth.apiKey ? "api_key" : "oauth");

    await this.#collection().login(providerId, resolved, interaction);
    this.#settings.recordConnection(providerId);
  }

  /**
   * Removes the stored credential, then the connection record.
   *
   * That order is deliberate: if credential removal fails, the provider still
   * reads as connected, which is true. The reverse would report a disconnection
   * that did not happen and leave the key behind.
   */
  async disconnect(providerId: string): Promise<void> {
    await this.#collection().logout(providerId);
    this.#settings.removeConnection(providerId);

    // A default model pointing at a provider with no credential would fail at
    // startup rather than at the moment the user caused it.
    const selection = this.#settings.getDefaultModel();
    if (selection?.provider === providerId) {
      this.#settings.clearDefaultModel();
    }
  }

  addCustomProvider(input: CustomProviderInput): CustomProviderConfig {
    const config = this.#settings.upsertCustomProvider({
      id: input.id,
      name: input.name ?? input.id,
      baseUrl: input.baseUrl,
      api: input.api ?? "openai-completions",
      models: input.models ?? [],
      contextWindow: input.contextWindow,
      maxTokens: input.maxTokens,
    });
    this.#invalidate();
    return config;
  }

  /**
   * Removes a user-declared provider and the credential that belongs to it.
   *
   * The credential is deleted first. Dropping the row while a key stayed in the
   * keychain would orphan a secret with nothing left to name it.
   */
  async removeCustomProvider(id: string): Promise<boolean> {
    if (this.#settings.getCustomProvider(id) === undefined) {
      return false;
    }

    await this.disconnect(id);
    const removed = this.#settings.removeCustomProvider(id);
    this.#invalidate();
    return removed;
  }

  getDefaultModel(): DefaultModelSelection | undefined {
    return this.#settings.getDefaultModel();
  }

  /**
   * Points the stable `project-studio/default` alias at a model.
   *
   * Validated with the same lookup the runtime uses to build its target, so a
   * selection that would fail at startup is refused at the moment it is made.
   */
  async selectDefaultModel(
    selection: DefaultModelSelection,
  ): Promise<DefaultModelSelection> {
    const models = this.#collection();

    if (models.getModel(selection.provider, selection.model) === undefined) {
      this.#requireProvider(selection.provider);
      throw new ProviderConfigurationError(
        `Provider "${selection.provider}" has no model "${selection.model}". For a custom provider, declare the model id when adding the provider.`,
      );
    }

    const check = await models.checkAuth(selection.provider).catch(() => undefined);
    if (check === undefined) {
      throw new ProviderConfigurationError(
        `Provider "${selection.provider}" is not connected. Connect it before selecting its model as the default.`,
      );
    }

    this.#settings.setDefaultModel(selection);
    return selection;
  }

  clearDefaultModel(): void {
    this.#settings.clearDefaultModel();
  }

  #requireProvider(providerId: string) {
    const provider = this.#collection().getProvider(providerId);
    if (!provider) {
      throw new ProviderConfigurationError(
        `Unknown provider "${providerId}". List the available providers, or add it as a custom provider with its base URL.`,
      );
    }
    return provider;
  }
}
