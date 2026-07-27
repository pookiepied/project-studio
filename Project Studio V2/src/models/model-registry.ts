import type {
  ModelDescriptor,
  ModelProviderAdapter,
  ModelProviderPort,
  ModelReference,
} from "../contracts/models.js";
import {
  ModelResolutionError,
  ProviderConfigurationError,
  type ModelSource,
} from "../contracts/models.js";

export class ModelRegistry implements ModelProviderPort {
  readonly #adapters = new Map<ModelSource, ModelProviderAdapter>();

  registerAdapter(adapter: ModelProviderAdapter): void {
    if (this.#adapters.has(adapter.source)) {
      throw new ProviderConfigurationError(
        `Model source "${adapter.source}" is already registered.`,
      );
    }
    this.#adapters.set(adapter.source, adapter);
  }

  resolve(reference: ModelReference): string {
    return this.resolveDescriptor(reference).resolvedModelId;
  }

  resolveDescriptor(reference: ModelReference): ModelDescriptor {
    const adapter = this.#adapters.get(reference.source);
    if (!adapter) {
      throw new ModelResolutionError(
        `Model source "${reference.source}" is not registered.`,
      );
    }
    return adapter.resolve(reference);
  }

  listModels(): readonly ModelDescriptor[] {
    return [...this.#adapters.values()].flatMap((adapter) =>
      adapter.listModels(),
    );
  }

  hasSource(source: ModelSource): boolean {
    return this.#adapters.has(source);
  }

  getAdapter(source: ModelSource): ModelProviderAdapter | undefined {
    return this.#adapters.get(source);
  }

  validate(reference: ModelReference): void {
    this.resolveDescriptor(reference);
  }
}
