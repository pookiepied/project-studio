import type { ProviderConfig } from "../../config/env.js";
import { StudioError } from "../../errors/error.js";
import { ErrorCodes } from "../../errors/codes.js";
import { executeSearch } from "../../runtime/search/execute.js";

export async function handleSearch(input: unknown, cfg: ProviderConfig) {
  const parsed = input as {
    query?: string;
    max_results?: number;
    topic?: "general" | "news" | "finance";
    time_range?: string;
    domains?: string[];
    exclude_domains?: string[];
    search_depth?: "basic" | "advanced";
    country?: string;
  };

  if (!parsed.query || typeof parsed.query !== "string" || parsed.query.trim().length === 0) {
    throw new StudioError(ErrorCodes.INVALID_QUERY, "query is required", 400);
  }

  const result = await executeSearch(
    {
      query: parsed.query,
      max_results: parsed.max_results,
      topic: parsed.topic,
      time_range: parsed.time_range,
      domains: parsed.domains,
      exclude_domains: parsed.exclude_domains,
      search_depth: parsed.search_depth,
      country: parsed.country,
    },
    cfg,
  );

  return {
    query: parsed.query,
    provider: result.provider,
    results: result.results,
    requestId: result.requestId,
  };
}
