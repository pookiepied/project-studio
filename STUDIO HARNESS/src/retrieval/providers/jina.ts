import { callProvider } from "../http.js";
import { retrievalKindForStatus, type RetrievalErrorKind } from "../errors.js";
import type { ReaderProvider, ReadRequest, ReadResult } from "../types.js";

/**
 * Jina Reader — the default page reader.
 *
 * It renders the page, including JavaScript, and returns markdown. That is why
 * it is the default rather than a plain HTTPS request with our own HTML
 * extraction: the pages an agent is most often pointed at — documentation
 * sites, dashboards, anything built this decade — are the ones a plain client
 * gets an empty shell from.
 *
 * **The cost, stated plainly:** every URL the agent reads is sent to Jina, and
 * Jina learns it. That includes internal documentation and anything behind a
 * link the user pasted. It is the trade ADR 0023 accepts, and the settings
 * screen says so in these words.
 */

const ENDPOINT = "https://r.jina.ai/";

/**
 * Jina reports a page it may not serve as 451, and a site that refused *it* as
 * 422 rather than as a bad request from us. Both are `blocked`: the request was
 * fine and the destination said no.
 */
function kindForStatus(status: number): RetrievalErrorKind {
  if (status === 451 || status === 422) return "blocked";
  return retrievalKindForStatus(status);
}

export function createJinaReader(apiKey: string): ReaderProvider {
  return {
    id: "jina",
    name: "Jina Reader",
    signupUrl: "https://jina.ai/reader",

    async read(request: ReadRequest): Promise<ReadResult> {
      const body = await callProvider({
        provider: "jina",
        // The URL is appended, not query-encoded: that is the service's own
        // shape. It has already been through `parseDestination`, so it is a
        // real http(s) URL with no credentials in it.
        url: `${ENDPOINT}${request.url}`,
        headers: {
          authorization: `Bearer ${apiKey}`,
          accept: "text/plain",
          // Ask for the title as a header rather than parsing it back out of
          // the markdown, which would guess.
          "x-with-generated-alt": "false",
        },
        signal: request.signal,
        // Rendering a page takes longer than answering a search.
        timeoutMs: 45_000,
        kindForStatus,
      });

      return { title: titleFrom(body), markdown: body };
    },
  };
}

/**
 * Reads the title Jina puts on the first line as `Title: ...`.
 *
 * Returned separately as well as left in the text: the tool result shows it,
 * and stripping it from the markdown would edit the page we were asked to
 * fetch.
 */
function titleFrom(markdown: string): string | undefined {
  const first = markdown.slice(0, 400).split("\n", 1)[0] ?? "";
  const match = /^Title:\s*(.+)$/.exec(first.trim());
  return match?.[1]?.trim() || undefined;
}
