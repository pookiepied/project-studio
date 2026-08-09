import { callProvider, parseProviderJson } from "../http.js";
import type { SearchProvider, SearchRequest, SearchResult } from "../types.js";

/**
 * Tavily — the default search provider.
 *
 * Chosen as the default because it returns an extract of each page rather than
 * a link and a title, which is the difference between one call and one call
 * plus five fetches.
 *
 * Worth knowing: Tavily was acquired by Nebius in February 2026. That does not
 * change the API today, and it is exactly the reason the fallback slot and the
 * one-file-per-provider shape exist.
 */

const ENDPOINT = "https://api.tavily.com/search";

interface TavilyResponse {
  readonly answer?: string | null;
  readonly results?: readonly {
    readonly title?: string;
    readonly url?: string;
    readonly content?: string;
  }[];
}

export function createTavilySearch(apiKey: string): SearchProvider {
  return {
    id: "tavily",
    name: "Tavily",
    signupUrl: "https://app.tavily.com",

    async search(request: SearchRequest): Promise<SearchResult> {
      const body = await callProvider({
        provider: "tavily",
        url: ENDPOINT,
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: {
          query: request.query,
          max_results: request.limit,
          // The cheap depth. "advanced" costs roughly four times as much for a
          // better extract, and that is a setting to expose once someone asks
          // for it, not a default to spend other people's money on.
          search_depth: "basic",
          include_answer: true,
        },
        signal: request.signal,
      });

      const parsed = parseProviderJson<TavilyResponse>("tavily", body);

      return {
        hits: (parsed.results ?? []).map((result) => ({
          title: result.title ?? "",
          url: result.url ?? "",
          snippet: result.content ?? "",
        })),
        summary: parsed.answer ?? undefined,
      };
    },
  };
}
