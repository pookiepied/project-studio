import { ErrorCodes } from "../../../errors/codes.js";
import { StudioError } from "../../../errors/error.js";
import { normalizeProviderStatus } from "../../../errors/normalize.js";
import type { FetchProvider, NormalizedFetchResponse } from "../types.js";

export function createTavilyExtractProvider(apiKey: string, timeoutMs = 15000): FetchProvider {
  return {
    name: "tavily-extract",
    async fetch(input) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch("https://api.tavily.com/extract", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            api_key: apiKey,
            urls: [input.url],
            extract_depth: "advanced",
            query: undefined,
          }),
          signal: controller.signal,
        });

        if (!res.ok) throw normalizeProviderStatus(res.status, "tavily");

        const data = (await res.json()) as {
          results?: Array<{ url: string; title?: string; content: string }>;
          failed_results?: unknown[];
          request_id?: string;
        };

        const first = data.results?.[0];
        if (!first?.content) {
          throw new StudioError(ErrorCodes.CONTENT_UNAVAILABLE, "tavily extract returned no content", 404);
        }

        return {
          url: input.url,
          final_url: first.url ?? input.url,
          title: first.title,
          content: first.content,
          content_type: "text/markdown",
          truncated: false,
          offset: 0,
          has_more: false,
          provider: "tavily",
          fetched_at: new Date().toISOString(),
        } satisfies NormalizedFetchResponse;
      } catch (e) {
        if (e instanceof StudioError) throw e;
        if (e instanceof DOMException && e.name === "AbortError") throw new StudioError(ErrorCodes.PROVIDER_TIMEOUT, "tavily extract timed out", 504);
        if (e instanceof TypeError) throw new StudioError(ErrorCodes.PROVIDER_UNAVAILABLE, "tavily network error", 502);
        throw e;
      } finally {
        clearTimeout(t);
      }
    },
  };
}
