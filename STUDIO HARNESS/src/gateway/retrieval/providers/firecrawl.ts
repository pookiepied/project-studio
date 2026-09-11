import { callProvider, parseProviderJson } from "../http.js";
import { RetrievalError } from "../errors.js";
import type { ReaderProvider, ReadRequest, ReadResult } from "../types.js";

/**
 * Firecrawl — the reader offered for the fallback slot.
 *
 * The closest peer to Jina Reader: it renders the page and returns markdown,
 * and it gets past bot checks that turn Jina away. It is the one candidate that
 * fails *differently* rather than failing in the same way for less money, which
 * is the only property that makes a fallback worth having.
 *
 * Its crawl and extract endpoints are deliberately not used. `fetch` reads one
 * page; a tool that could crawl a site is a different capability with a
 * different cost and a different permission question.
 */

// v2 is the API Firecrawl now documents (checked 2026-09-11); v1 still
// answers, but a scheduled migration beats an outage. The fields this file
// sends and reads - formats, onlyMainContent, data.markdown - are the same.
const ENDPOINT = "https://api.firecrawl.dev/v2/scrape";

interface FirecrawlResponse {
  readonly success?: boolean;
  readonly error?: string;
  readonly data?: {
    readonly markdown?: string;
    readonly metadata?: { readonly title?: string };
  };
}

export function createFirecrawlReader(apiKey: string): ReaderProvider {
  return {
    id: "firecrawl",
    name: "Firecrawl",
    signupUrl: "https://www.firecrawl.dev",

    async read(request: ReadRequest): Promise<ReadResult> {
      const body = await callProvider({
        provider: "firecrawl",
        url: ENDPOINT,
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json",
        },
        body: { url: request.url, formats: ["markdown"], onlyMainContent: true },
        signal: request.signal,
        timeoutMs: 45_000,
      });

      const parsed = parseProviderJson<FirecrawlResponse>("firecrawl", body);

      // Firecrawl answers 200 with `success: false` for a page it could not
      // read. Mapped here rather than left to the shared status check, which
      // would call this a success and return an empty page.
      if (parsed.success === false || parsed.data?.markdown === undefined) {
        throw new RetrievalError("blocked", {
          provider: "firecrawl",
          message: parsed.error
            ? `Firecrawl could not read the page: ${parsed.error}`
            : "Firecrawl could not read the page.",
        });
      }

      return {
        title: parsed.data.metadata?.title,
        markdown: parsed.data.markdown,
      };
    },
  };
}
