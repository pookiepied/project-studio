import { ErrorCodes } from "../../../errors/codes.js";
import { StudioError } from "../../../errors/error.js";
import { normalizeProviderStatus } from "../../../errors/normalize.js";
import type { NormalizedSearchResponse, SearchProvider } from "../types.js";

export interface TavilySearchOpts {
  query: string;
  max_results?: number;
  topic?: "general" | "news" | "finance";
  time_range?: string;
  include_domains?: string[];
  exclude_domains?: string[];
  search_depth?: "basic" | "advanced";
  include_answer?: boolean;
  include_raw_content?: boolean;
}

export function createTavilySearchProvider(apiKey: string, timeoutMs = 10000): SearchProvider {
  return {
    name: "tavily",
    async search(input) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const body = {
          api_key: apiKey,
          query: input.query,
          max_results: input.max_results ?? 5,
          topic: (input as TavilySearchOpts).topic ?? "general",
          search_depth: (input as TavilySearchOpts).search_depth ?? "basic",
          ...( (input as TavilySearchOpts).include_domains ? { include_domains: (input as TavilySearchOpts).include_domains } : {}),
          ...( (input as TavilySearchOpts).exclude_domains ? { exclude_domains: (input as TavilySearchOpts).exclude_domains } : {}),
          ...( (input as TavilySearchOpts).time_range ? { time_range: (input as TavilySearchOpts).time_range } : {}),
          include_answer: false,
          include_raw_content: false,
        };

        const res = await fetch("https://api.tavily.com/search", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!res.ok) {
          throw normalizeProviderStatus(res.status, "tavily");
        }

        const data = (await res.json()) as {
          results?: Array<{ title: string; url: string; content: string; score?: number; raw_content?: string }>;
          request_id?: string;
          answer?: string;
        };

        const results = (data.results ?? []).map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          content: r.content ?? r.raw_content ?? "",
          score: r.score,
        }));

        return {
          results,
          provider: "tavily",
          requestId: data.request_id,
        } satisfies NormalizedSearchResponse;
      } catch (e) {
        if (e instanceof StudioError) throw e;
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new StudioError(ErrorCodes.PROVIDER_TIMEOUT, "tavily search timed out", 504);
        }
        if (e instanceof TypeError) {
          throw new StudioError(ErrorCodes.PROVIDER_UNAVAILABLE, "tavily network error", 502);
        }
        throw e;
      } finally {
        clearTimeout(t);
      }
    },
  };
}
