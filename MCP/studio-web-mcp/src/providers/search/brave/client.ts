import { ErrorCodes } from "../../../errors/codes.js";
import { StudioError } from "../../../errors/error.js";
import { normalizeProviderStatus } from "../../../errors/normalize.js";
import type { NormalizedSearchResponse, SearchProvider } from "../types.js";

export function createBraveSearchProvider(apiKey: string, timeoutMs = 10000): SearchProvider {
  return {
    name: "brave",
    async search(input) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const url = new URL("https://api.search.brave.com/res/v1/web/search");
        url.searchParams.set("q", input.query);
        url.searchParams.set("count", String(input.max_results ?? 5));

        const res = await fetch(url.toString(), {
          headers: {
            Accept: "application/json",
            "X-Subscription-Token": apiKey,
          },
          signal: controller.signal,
        });

        if (!res.ok) {
          throw normalizeProviderStatus(res.status, "brave");
        }

        const data = (await res.json()) as {
          web?: { results?: Array<{ title: string; url: string; description: string; extra_snippets?: string[] }> };
          query?: { original?: string };
        };

        const raw = data.web?.results ?? [];
        const results = raw.map((r) => ({
          title: r.title ?? "",
          url: r.url ?? "",
          content: r.description ?? (r.extra_snippets?.join(" ") ?? ""),
        }));

        return { results, provider: "brave" } satisfies NormalizedSearchResponse;
      } catch (e) {
        if (e instanceof StudioError) throw e;
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new StudioError(ErrorCodes.PROVIDER_TIMEOUT, "brave search timed out", 504);
        }
        if (e instanceof TypeError) throw new StudioError(ErrorCodes.PROVIDER_UNAVAILABLE, "brave network error", 502);
        throw e;
      } finally {
        clearTimeout(t);
      }
    },
  };
}
