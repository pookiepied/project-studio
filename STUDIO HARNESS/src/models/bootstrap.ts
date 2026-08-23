import {
  defaultModelReference,
  ProviderConfigurationError,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type ModelSource,
} from "../contracts/models.js";
import type { ProviderConfig } from "./provider-config.js";
import { ModelRegistry } from "./model-registry.js";
import { TestModelProviderAdapter } from "./adapters/test-adapter.js";
import type { SecureCredentialStore } from "../credentials/credential-store.js";
import { KeyringCredentialStore } from "../credentials/keyring-store.js";
import { LocalModelProviderAdapter } from "./adapters/local-adapter.js";
import type { StudioDatabase } from "../storage/database.js";
import {
  mergeCustomProviders,
  resolveLocalModelConfig,
  type LocalModelConfig,
} from "./local/config.js";
import { ProviderSettingsStore } from "./local/settings-store.js";
import { PiCredentialStore } from "./local/credential-bridge.js";
import { createLocalRuntime } from "./local/runtime.js";

export interface LocalBootstrapOverrides {
  readonly config?: LocalModelConfig;
  readonly credentials?: SecureCredentialStore;
}

export interface BootstrapOptions {
  readonly local?: LocalBootstrapOverrides;
  /**
   * The database provider settings are read from.
   *
   * Passed in rather than resolved from a module global, so the caller that
   * owns the connection is the caller that decides which one this uses. Only
   * required when `local.config` is absent, which is the path that reads
   * stored settings (ADR 0035 §3).
   */
  readonly database?: StudioDatabase;
}

/**
 * Creates the adapter for a source.
 *
 * `local` validates the user's provider settings before Flue registration,
 * registry construction, or OpenTelemetry initialization, so a missing default
 * model or an unusable custom provider is a clean startup failure. Selecting a
 * source is never quietly turned into a run on a different one.
 */
export function createModelProviderAdapter(
  source: ModelSource,
  options: BootstrapOptions = {},
): ModelProviderAdapter {
  switch (source) {
    case "test":
      return new TestModelProviderAdapter();
    case "local":
      return createLocalAdapter(options.local ?? {}, options.database);
    default:
      throw new ProviderConfigurationError(
        `Unknown model source "${String(source)}".`,
      );
  }
}

/**
 * Builds the local BYOK source.
 *
 * The user's provider credentials stay in the OS keychain and are read by Pi
 * during auth resolution; nothing here holds a key. Configuration is validated
 * eagerly so a bad default model or an unusable custom provider fails at
 * startup, but the credential store is not consulted, because a user may
 * legitimately start the harness before connecting any provider.
 */
function createLocalAdapter(
  overrides: LocalBootstrapOverrides,
  database: StudioDatabase | undefined,
): LocalModelProviderAdapter {
  let config = overrides.config;
  if (config === undefined) {
    if (database === undefined) {
      throw new ProviderConfigurationError(
        "Local model settings cannot be read without a database.",
      );
    }
    config = resolveLocalModelConfigFromSettings(database);
  }
  const credentials = overrides.credentials ?? new KeyringCredentialStore();

  const runtime = createLocalRuntime({
    config,
    credentials: new PiCredentialStore(credentials),
  });

  return new LocalModelProviderAdapter({ config, runtime });
}

/**
 * Reads the local configuration the user actually chose.
 *
 * Provider settings are the source of truth; the environment variables are the
 * override for development and for runs with no settings database. An
 * unreadable settings database is not swallowed — a user who configured
 * providers in the UI must not silently start on stale environment values.
 */
function resolveLocalModelConfigFromSettings(database: StudioDatabase): LocalModelConfig {
  const settings = new ProviderSettingsStore(database);
  const selection = settings.getDefaultModel();

  return resolveLocalModelConfig({
    ...(selection ? { defaultSelection: selection } : {}),
    customProviders: mergeCustomProviders(settings.listCustomProviders()),
  });
}

/**
 * The configured registry is the handle for everything downstream; the
 * selected adapter is reachable through `registry.getAdapter(source)` when a
 * caller needs source-specific behavior such as `loadCatalog()`.
 */
export interface BootstrapResult {
  readonly config: ProviderConfig;
  readonly registry: ModelRegistry;
  readonly descriptor: ModelDescriptor;
}

export class ProviderBootstrapCoordinator {
  #initialized = false;

  bootstrap(
    config: ProviderConfig,
    options: BootstrapOptions = {},
  ): BootstrapResult {
    if (this.#initialized) {
      throw new ProviderConfigurationError(
        "Model providers have already been bootstrapped; duplicate bootstrap is not allowed.",
      );
    }
    this.#initialized = true;

    const adapter = createModelProviderAdapter(config.source, options);
    adapter.register();

    const registry = new ModelRegistry();
    registry.registerAdapter(adapter);

    const descriptor = registry.resolveDescriptor(
      defaultModelReference(config.source),
    );

    return { config, registry, descriptor };
  }
}

export function createProviderBootstrapCoordinator(): ProviderBootstrapCoordinator {
  return new ProviderBootstrapCoordinator();
}

const productionCoordinator = createProviderBootstrapCoordinator();

export function bootstrapModelProviders(
  config: ProviderConfig,
  options: BootstrapOptions = {},
): BootstrapResult {
  return productionCoordinator.bootstrap(config, options);
}
