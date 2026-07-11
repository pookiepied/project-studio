/**
 * Intra-run tool execution coordinator.
 *
 * The AI SDK may execute independent tool calls in parallel. We preserve that.
 * This coordinator only serializes calls that explicitly share a
 * `concurrencyKey` in their ToolPolicy, such as writes to the same file, git
 * mutations, or updates to the same external record.
 *
 * These locks are intentionally in-memory and attempt-scoped. Crash/recovery
 * safety is handled by durable operation records; locks only prevent concurrent
 * conflicts inside a live run attempt.
 */
export class ToolExecutionCoordinator {
  private readonly tails = new Map<string, Promise<void>>();

  async run<T>(key: string | undefined, work: () => Promise<T>): Promise<T> {
    if (!key) return work();

    const previous = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const tail = previous.then(() => current, () => current);
    this.tails.set(key, tail);

    await previous.catch(() => undefined);
    try {
      return await work();
    } finally {
      release();
      if (this.tails.get(key) === tail) {
        this.tails.delete(key);
      }
    }
  }
}
