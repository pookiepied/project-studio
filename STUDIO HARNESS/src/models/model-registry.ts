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

  /**
   * The background-job model of the first registered source that can name
   * one at the requested rank. One source is bootstrapped per process, so
   * the loop is the contract's shape rather than a search; undefined means
   * no registered source could name a model there, and the caller falls
   * back to the alias at rank zero or gives up the ladder beyond it.
   */
  async backgroundModel(skip = 0): Promise<string | undefined> {
    for (const adapter of this.#adapters.values()) {
      const specifier = await adapter.backgroundModel(skip);
      if (specifier !== undefined) return specifier;
    }
    return undefined;
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
