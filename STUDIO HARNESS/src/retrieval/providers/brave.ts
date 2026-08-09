import { callProvider, parseProviderJson } from "../http.js";
import type { SearchProvider, SearchRequest, SearchResult } from "../types.js";

/**
 * Brave Search — an independent index.
 *
 * The reason to offer it is not price. It crawls its own index rather than
 * reselling someone else's, so it answers differently on the queries a
 * general-purpose index buries. It returns descriptions rather than page
 * extracts, so results are shorter and the agent fetches more often.
 */

const ENDPOINT = "https://api.search.brave.com/res/v1/web/search";

interface BraveResponse {
  readonly web?: {
    readonly results?: readonly {
      readonly title?: string;
      readonly url?: string;
      readonly description?: string;
    }[];
  };
}

export function createBraveSearch(apiKey: string): SearchProvider {
  return {
    id: "brave",
    name: "Brave Search",
    signupUrl: "https://api-dashboard.search.brave.com",

    async search(request: SearchRequest): Promise<SearchResult> {
      const url = new URL(ENDPOINT);
      url.searchParams.set("q", request.query);
      url.searchParams.set("count", String(request.limit));

      const body = await callProvider({
        provider: "brave",
        url: url.toString(),
        headers: {
          "x-subscription-token": apiKey,
          "accept-encoding": "gzip",
        },
        signal: request.signal,
      });

      const parsed = parseProviderJson<BraveResponse>("brave", body);

      return {
        hits: (parsed.web?.results ?? []).map((result) => ({
          title: result.title ?? "",
          url: result.url ?? "",
          // Brave marks matched terms with <strong>. Left as text rather than
          // rendered: the model reads this, and stray tags are noise.
          snippet: (result.description ?? "").replace(/<[^>]+>/g, ""),
        })),
        summary: undefined,
      };
    },
  };
}
