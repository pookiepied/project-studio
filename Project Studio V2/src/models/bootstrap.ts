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

const UNAVAILABLE_SOURCE_PHASE: Record<Exclude<ModelSource, "test">, string> = {
  local: "Phase 7",
  "studio-cloud": "Phase 8",
};

/**
 * Only "test" is operational in Phase 6. Selecting "local" or "studio-cloud"
 * must fail immediately, before any registration or registry work, rather
 * than publishing a placeholder adapter that quietly cannot serve a model.
 */
export function createModelProviderAdapter(
  source: ModelSource,
): ModelProviderAdapter {
  switch (source) {
    case "test":
      return new TestModelProviderAdapter();
    case "local":
    case "studio-cloud":
      throw new ProviderConfigurationError(
        `Model source "${source}" is not available until ${UNAVAILABLE_SOURCE_PHASE[source]}. Only "test" is operational in Phase 6.`,
      );
    default:
      throw new ProviderConfigurationError(
        `Unknown model source "${source as string}".`,
      );
  }
}

export interface BootstrapResult {
  readonly config: ProviderConfig;
  readonly registry: ModelRegistry;
  readonly descriptor: ModelDescriptor;
}

export class ProviderBootstrapCoordinator {
  #initialized = false;

  bootstrap(config: ProviderConfig): BootstrapResult {
    if (this.#initialized) {
      throw new ProviderConfigurationError(
        "Model providers have already been bootstrapped; duplicate bootstrap is not allowed.",
      );
    }
    this.#initialized = true;

    const adapter = createModelProviderAdapter(config.source);
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
): BootstrapResult {
  return productionCoordinator.bootstrap(config);
}
