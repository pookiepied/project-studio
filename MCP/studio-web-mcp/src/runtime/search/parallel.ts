import type { ProviderConfig } from "../../config/env.js";
import { executeSearch, type SearchRuntimeInput } from "./execute.js";

export async function executeSearchParallel(
  queries: SearchRuntimeInput[],
  cfg: ProviderConfig,
  concurrency = 3,
): Promise<Awaited<ReturnType<typeof executeSearch>>[]> {
  const results: Awaited<ReturnType<typeof executeSearch>>[] = [];
  const queue = [...queries];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const q = queue.shift()!;
      const r = await executeSearch(q, cfg);
      results.push(r);
    }
  });
  await Promise.all(workers);
  return results;
}
