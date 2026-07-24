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
import { StudioCloudModelProviderAdapter } from "./adapters/studio-cloud-adapter.js";
import {
  assertAccessTokenConfigured,
  createEnvAccessTokenProvider,
  type AccessTokenProvider,
} from "./studio-cloud/auth.js";
import type { FetchLike } from "./studio-cloud/client.js";
import {
  resolveStudioGatewayConfig,
  type StudioGatewayConfig,
} from "./studio-cloud/config.js";

export interface StudioCloudBootstrapOverrides {
  readonly config?: StudioGatewayConfig;
  readonly tokenProvider?: AccessTokenProvider;
  readonly fetchImpl?: FetchLike;
}

export interface BootstrapOptions {
  readonly studioCloud?: StudioCloudBootstrapOverrides;
}

/**
 * Creates the adapter for a source.
 *
 * `studio-cloud` validates its URL and credentials here, before Flue
 * registration, registry construction, or OpenTelemetry initialization, so an
 * unusable configuration is a clean startup failure.
 *
 * `local` is recognized but not operational: the BYOK runtime needs
 * user-controlled provider credentials in secure OS storage, which is the next
 * phase. There is no placeholder adapter, and selecting it is never quietly
 * turned into a Studio run.
 */
export function createModelProviderAdapter(
  source: ModelSource,
  options: BootstrapOptions = {},
): ModelProviderAdapter {
  switch (source) {
    case "test":
      return new TestModelProviderAdapter();
    case "studio-cloud":
      return createStudioCloudAdapter(options.studioCloud ?? {});
    case "local":
      throw new ProviderConfigurationError(
        'Model source "local" is not available yet. The local BYOK runtime requires secure OS credential storage, which ships in the next phase; it is never substituted with the Studio gateway.',
      );
    default:
      throw new ProviderConfigurationError(
        `Unknown model source "${source as string}".`,
      );
  }
}

function createStudioCloudAdapter(
  overrides: StudioCloudBootstrapOverrides,
): StudioCloudModelProviderAdapter {
  const config = overrides.config ?? resolveStudioGatewayConfig();

  let tokenProvider = overrides.tokenProvider;
  if (tokenProvider === undefined) {
    assertAccessTokenConfigured();
    tokenProvider = createEnvAccessTokenProvider();
  }

  return new StudioCloudModelProviderAdapter({
    config,
    tokenProvider,
    ...(overrides.fetchImpl === undefined ? {} : { fetchImpl: overrides.fetchImpl }),
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
