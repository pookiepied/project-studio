import type { ProviderConfig } from "../../config/env.js";
import { executeFetch, type FetchRuntimeInput } from "./execute.js";

export async function executeFetchParallel(
  inputs: FetchRuntimeInput[],
  cfg: ProviderConfig,
  concurrency = 3,
) {
  const queue = [...inputs];
  const results: Awaited<ReturnType<typeof executeFetch>>[] = [];
  const workers = Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length) {
      const item = queue.shift()!;
      const r = await executeFetch(item, cfg);
      results.push(r);
    }
  });
  await Promise.all(workers);
  return results;
}
