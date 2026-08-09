/**
 * Provider registry — code owns the map, env picks primary/fallback.
 * No if/else strings scattered in runtime; registry is the single source.
 */
import type { ProviderConfig } from "./env.js";
import { createTavilySearchProvider } from "../providers/search/tavily/client.js";
import { createBraveSearchProvider } from "../providers/search/brave/client.js";
import { createJinaFetchProvider } from "../providers/fetch/jina/client.js";
import { createTavilyExtractProvider } from "../providers/fetch/tavily/client.js";
import type { SearchProvider } from "../providers/search/types.js";
import type { FetchProvider } from "../providers/fetch/types.js";

export function getSearchProvider(name: string, cfg: ProviderConfig): SearchProvider {
  const n = name.toLowerCase();
  if (n === "tavily") return createTavilySearchProvider(cfg.tavilyKey!);
  if (n === "brave") return createBraveSearchProvider(cfg.braveKey!);
  throw new Error(`Unknown search provider: ${name}`);
}

export function getFetchProvider(name: string, cfg: ProviderConfig): FetchProvider {
  const n = name.toLowerCase();
  if (n === "jina") return createJinaFetchProvider(cfg.jinaKey);
  if (n === "tavily") return createTavilyExtractProvider(cfg.tavilyKey!);
  throw new Error(`Unknown fetch provider: ${name}`);
}
