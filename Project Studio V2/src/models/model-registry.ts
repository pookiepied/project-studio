import type {
  ModelProviderPort,
  ModelReference,
  ModelSource,
} from "../contracts/models.js";

type SourceResolver = (reference: ModelReference) => string;

export class ModelRegistry implements ModelProviderPort {
  readonly #resolvers = new Map<ModelSource, SourceResolver>();

  register(source: ModelSource, resolver: SourceResolver): void {
    if (this.#resolvers.has(source)) {
      throw new Error(`Model source "${source}" is already registered.`);
    }

    this.#resolvers.set(source, resolver);
  }

  resolve(reference: ModelReference): string {
    const resolver = this.#resolvers.get(reference.source);
    if (!resolver) {
      throw new Error(`Model source "${reference.source}" is not registered.`);
    }

    return resolver(reference);
  }
}
