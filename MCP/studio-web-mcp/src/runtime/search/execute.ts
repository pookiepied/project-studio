import { ErrorCodes } from "../../errors/codes.js";
import { StudioError } from "../../errors/error.js";
import { shouldFallback } from "../../errors/normalize.js";
import type { ProviderConfig } from "../../config/env.js";
import { assertProviderConfigured } from "../../config/env.js";
import { createBraveSearchProvider } from "../../providers/search/brave/client.js";
import { createTavilySearchProvider } from "../../providers/search/tavily/client.js";
import type { NormalizedSearchResponse } from "../../providers/search/types.js";

export interface SearchRuntimeInput {
  query: string;
  max_results?: number;
  topic?: "general" | "news" | "finance";
  time_range?: string;
  domains?: string[];
  exclude_domains?: string[];
  search_depth?: "basic" | "advanced";
  country?: string;
}

function resolveProvider(name: string, cfg: ProviderConfig) {
  const n = name.toLowerCase();
  if (n === "tavily") {
    assertProviderConfigured("tavily", cfg);
    return createTavilySearchProvider(cfg.tavilyKey!);
  }
  if (n === "brave") {
    assertProviderConfigured("brave", cfg);
    return createBraveSearchProvider(cfg.braveKey!);
  }
  throw new StudioError(ErrorCodes.PROVIDER_NOT_CONFIGURED, `Unknown search provider "${name}"`, 500);
}

export async function executeSearch(
  input: SearchRuntimeInput,
  cfg: ProviderConfig,
): Promise<NormalizedSearchResponse> {
  const primaryName = cfg.searchPrimary ?? "tavily";
  const fallbackName = cfg.searchFallback ?? "brave";

  const primary = resolveProvider(primaryName, cfg);

  try {
    const res = await primary.search({
      query: input.query,
      max_results: input.max_results,
      topic: input.topic,
      time_range: input.time_range,
      include_domains: input.domains,
      exclude_domains: input.exclude_domains,
      search_depth: input.search_depth,
    });
    return res;
  } catch (e) {
    // Do not fallback on validation / auth / config errors
    if (e instanceof StudioError && (e.code === ErrorCodes.PROVIDER_NOT_CONFIGURED || e.code === ErrorCodes.AUTH_FAILED || e.code === ErrorCodes.INVALID_QUERY || e.code === ErrorCodes.INVALID_REQUEST)) {
      throw e;
    }
    if (!shouldFallback(e)) throw e;
    if (fallbackName.toLowerCase() === primaryName.toLowerCase()) throw e;

    // Try fallback
    try {
      const fallback = resolveProvider(fallbackName, cfg);
      const res2 = await fallback.search({
        query: input.query,
        max_results: input.max_results,
        topic: input.topic,
        time_range: input.time_range,
        include_domains: input.domains,
        exclude_domains: input.exclude_domains,
        search_depth: input.search_depth,
      });
      return res2;
    } catch (e2) {
      // Both failed
      if (e2 instanceof StudioError) throw e2;
      throw new StudioError(ErrorCodes.SEARCH_FAILED, `Search failed: ${String((e2 as Error)?.message ?? e2).slice(0, 300)}`, 502);
    }
  }
}
