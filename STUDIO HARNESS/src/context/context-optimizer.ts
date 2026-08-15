export interface ContextEnvelope<T> {
  readonly canonical: T;
  readonly optimized: T;
  readonly optimizer: string;
}

export interface ContextOptimizer {
  optimize<T>(context: T, signal?: AbortSignal): Promise<ContextEnvelope<T>>;
}

/**
 * The identity optimizer.
 *
 * **Declared, not wired.** ADR 0003 specifies a `ContextOptimizer` port with a
 * passthrough implementation to start, and compression as a later optional
 * sidecar behind it. Flue assembles the context window today, so nothing calls
 * this yet — deliberately, and it is not dead code to be deleted on the next
 * sweep. `roadmap.md` records the same thing.
 *
 * It is kept honest by being cheap: the port is two methods and this
 * implementation returns its input. If it ever grows logic without a caller,
 * that is the point to delete it and supersede ADR 0003 rather than to keep
 * carrying it.
 */
export class PassthroughContextOptimizer implements ContextOptimizer {
  async optimize<T>(context: T): Promise<ContextEnvelope<T>> {
    return {
      canonical: context,
      optimized: context,
      optimizer: "passthrough",
    };
  }
}
