export interface ContextEnvelope<T> {
  readonly canonical: T;
  readonly optimized: T;
  readonly optimizer: string;
}

export interface ContextOptimizer {
  optimize<T>(context: T, signal?: AbortSignal): Promise<ContextEnvelope<T>>;
}

export class PassthroughContextOptimizer implements ContextOptimizer {
  async optimize<T>(context: T): Promise<ContextEnvelope<T>> {
    return {
      canonical: context,
      optimized: context,
      optimizer: "passthrough",
    };
  }
}
