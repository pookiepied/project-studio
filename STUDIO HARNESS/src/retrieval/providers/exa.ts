import { callProvider, parseProviderJson } from "../http.js";
import type { SearchProvider, SearchRequest, SearchResult } from "../types.js";

/**
 * Exa — meaning-based search.
 *
 * It matches on what a page is about rather than on the words in it, which is
 * better for "find me pages like this" and worse for an exact string. Offered
 * because that is a genuinely different answer, not a cheaper one.
 */

const ENDPOINT = "https://api.exa.ai/search";

interface ExaResponse {
  readonly results?: readonly {
    readonly title?: string | null;
    readonly url?: string;
    readonly text?: string;
  }[];
}

export function createExaSearch(apiKey: string): SearchProvider {
  return {
    id: "exa",
    name: "Exa",
    signupUrl: "https://dashboard.exa.ai",

    async search(request: SearchRequest): Promise<SearchResult> {
      const body = await callProvider({
        provider: "exa",
        url: ENDPOINT,
        method: "POST",
        headers: { "x-api-key": apiKey, "content-type": "application/json" },
        body: {
          query: request.query,
          numResults: request.limit,
          // Exa returns links unless contents are asked for, and a link list is
          // the thing this whole subsystem exists to avoid. Capped, because the
          // full text of ten pages is a context window, not a search result.
          contents: { text: { maxCharacters: 2_000 } },
        },
        signal: request.signal,
      });

      const parsed = parseProviderJson<ExaResponse>("exa", body);

      return {
        hits: (parsed.results ?? []).map((result) => ({
          title: result.title ?? "",
          url: result.url ?? "",
          snippet: result.text ?? "",
        })),
        summary: undefined,
      };
    },
  };
}
