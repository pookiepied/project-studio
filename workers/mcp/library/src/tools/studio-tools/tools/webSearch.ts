/**
 * web_search — Tavily (primary) with Brave Search fallback.
 * Ported from the chat worker's WebSearchTool. env is passed explicitly.
 */

const TAVILY_API_URL   = "https://api.tavily.com/search";
const BRAVE_SEARCH_URL = "https://api.search.brave.com/res/v1/web/search";
const TAVILY_FALLBACK_STATUSES = new Set([401, 402, 429, 500, 502, 503, 504]);

export interface WebSearchEnv {
  TAVILY_API_KEY?:       string;
  BRAVE_SEARCH_API_KEY?: string;
}

export interface WebSearchArgs {
  query: string;
  maxResults?: number;
}

export async function runWebSearch(env: WebSearchEnv, args: WebSearchArgs): Promise<unknown> {
  const query      = String(args.query ?? "");
  const maxResults = Math.min(Number(args.maxResults ?? 5), 10);
  let tavilyFailed = false;

  // ── Tavily (primary) ──────────────────────────────────────────────────────
  if (env?.TAVILY_API_KEY) {
    try {
      const response = await fetch(TAVILY_API_URL, {
        method:  "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body:    JSON.stringify({
          api_key:             env.TAVILY_API_KEY,
          query,
          search_depth:        "basic",
          include_answer:      true,
          include_raw_content: false,
          max_results:         maxResults,
        }),
      });

      if (response.ok) {
        const data: any = await response.json();
        return {
          query,
          answer:  data.answer ?? null,
          results: (data.results ?? []).map((r: any) => ({
            title:   r.title   ?? "",
            url:     r.url     ?? "",
            content: r.content ?? "",
            score:   r.score   ?? 0,
          })),
          via: "tavily",
        };
      }

      if (!TAVILY_FALLBACK_STATUSES.has(response.status)) {
        return { error: `Tavily returned HTTP ${response.status}: ${await response.text()}` };
      }
      tavilyFailed = true;
    } catch {
      tavilyFailed = true;
    }
  }

  // ── Brave Search (fallback) ───────────────────────────────────────────────
  if (env?.BRAVE_SEARCH_API_KEY) {
    try {
      const params   = new URLSearchParams({ q: query, count: String(maxResults) });
      const response = await fetch(`${BRAVE_SEARCH_URL}?${params}`, {
        headers: {
          "X-Subscription-Token": env.BRAVE_SEARCH_API_KEY,
          Accept:                 "application/json",
          "Accept-Encoding":      "gzip",
        },
      });

      if (!response.ok) {
        const prefix = tavilyFailed ? "Tavily unavailable and Brave Search" : "Brave Search";
        return { error: `${prefix} returned HTTP ${response.status}: ${await response.text()}` };
      }

      const data: any = await response.json();
      return {
        query,
        answer:  null,
        results: (data.web?.results ?? []).map((r: any) => ({
          title:   r.title       ?? "",
          url:     r.url         ?? "",
          content: r.description ?? "",
          score:   0,
        })),
        via: "brave",
      };
    } catch (e: any) {
      return { error: `Brave Search failed: ${e.message}` };
    }
  }

  if (tavilyFailed) {
    return { error: "Tavily is unavailable and BRAVE_SEARCH_API_KEY is not configured for fallback." };
  }
  return { error: "No search provider configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY." };
}
