import { createBraveSearch } from "./providers/brave.js";
import { createExaSearch } from "./providers/exa.js";
import { createFirecrawlReader } from "./providers/firecrawl.js";
import { createJinaReader } from "./providers/jina.js";
import { createTavilySearch } from "./providers/tavily.js";
import type { ProviderFactory, ReaderProvider, SearchProvider } from "./types.js";

/**
 * Every provider the harness knows how to talk to.
 *
 * These two tables are the whole extensibility surface. Adding a service is one
 * adapter file and one row; a fork that prefers a different vendor changes one
 * default. Nothing above this file names a provider, which is what keeps that
 * promise true.
 *
 * There is no "any compatible endpoint" escape hatch of the kind BYOK models
 * have, because search APIs share no wire format. There would be nothing to be
 * generic about.
 */

export const SEARCH_PROVIDERS: Readonly<Record<string, ProviderFactory<SearchProvider>>> =
  {
    tavily: createTavilySearch,
    brave: createBraveSearch,
    exa: createExaSearch,
  };

export const READER_PROVIDERS: Readonly<Record<string, ProviderFactory<ReaderProvider>>> =
  {
    jina: createJinaReader,
    firecrawl: createFirecrawlReader,
  };

/** The provider used when the user has not chosen one. See ADR 0023 §2. */
export const DEFAULT_SEARCH_PROVIDER = "tavily";
export const DEFAULT_READER_PROVIDER = "jina";

export function isSearchProviderId(id: string): boolean {
  return Object.hasOwn(SEARCH_PROVIDERS, id);
}

export function isReaderProviderId(id: string): boolean {
  return Object.hasOwn(READER_PROVIDERS, id);
}
