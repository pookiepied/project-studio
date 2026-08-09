import { ErrorCodes } from "../../../errors/codes.js";
import { StudioError } from "../../../errors/error.js";
import { normalizeProviderStatus } from "../../../errors/normalize.js";
import type { FetchProvider, NormalizedFetchResponse } from "../types.js";

/**
 * Jina Reader — https://r.jina.ai/http://example.com
 * Supports Bearer token via Authorization header.
 * Returns markdown/text. We request markdown and handle large docs via offset truncation downstream.
 */
export function createJinaFetchProvider(apiKey?: string, timeoutMs = 15000): FetchProvider {
  return {
    name: "jina",
    async fetch(input) {
      const controller = new AbortController();
      const t = setTimeout(() => controller.abort(), timeoutMs);
      try {
        // Jina Reader expects https://r.jina.ai/http://target
        // Ensure url has scheme; r.jina.ai preserves it.
        const target = input.url;
        const jinaUrl = `https://r.jina.ai/${target}`;

        const headers: Record<string, string> = {
          Accept: "text/markdown",
          "X-Retain-Images": "none",
          "X-With-Generated-Alt": "true",
        };
        if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

        const res = await fetch(jinaUrl, { headers, signal: controller.signal });

        if (!res.ok) {
          throw normalizeProviderStatus(res.status, "jina");
        }

        const contentType = res.headers.get("content-type") ?? "text/markdown";
        const raw = await res.text();
        const titleMatch = raw.match(/^Title:\s*(.*)$/m);
        const title = titleMatch?.[1]?.trim();

        // Content is full markdown; truncation handled by runtime/content.ts
        return {
          url: input.url,
          final_url: target,
          title,
          content: raw,
          content_type: contentType,
          truncated: false,
          offset: 0,
          has_more: false,
          provider: "jina",
          fetched_at: new Date().toISOString(),
        } satisfies NormalizedFetchResponse;
      } catch (e) {
        if (e instanceof StudioError) throw e;
        if (e instanceof DOMException && e.name === "AbortError") {
          throw new StudioError(ErrorCodes.PROVIDER_TIMEOUT, "jina fetch timed out", 504);
        }
        if (e instanceof TypeError) throw new StudioError(ErrorCodes.PROVIDER_UNAVAILABLE, "jina network error", 502);
        throw e;
      } finally {
        clearTimeout(t);
      }
    },
  };
}
