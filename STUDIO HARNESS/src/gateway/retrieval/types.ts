/**
 * What a retrieval provider is.
 *
 * The subsystem is deliberately separate from `src/tools/`. A tool is a thing
 * the model calls; a provider is a service we buy from. Keeping them apart is
 * what lets the tool schema stay fixed while providers come and go, and it is
 * why no provider name appears anywhere in `web_search` or `fetch`.
 *
 * Every adapter here is small on purpose: build a request, read a response, map
 * the failure. Anything cleverer belongs above them, in one place, not repeated
 * five times.
 */

/** One result from a web search. */
interface SearchHit {
  readonly title: string;
  readonly url: string;
  /**
   * The provider's extract of the page, when it supplies one. This is the
   * reason Tavily and Exa are worth more than a link list: without it the agent
   * has to fetch every result to find out which one mattered.
   */
  readonly snippet: string;
}

export interface SearchResult {
  readonly hits: readonly SearchHit[];
  /**
   * The provider's own one-line answer, when it has one. Never presented as
   * fact — it is the same untrusted content as the hits, from the same pages.
   */
  readonly summary: string | undefined;
}

export interface SearchRequest {
  readonly query: string;
  readonly limit: number;
  readonly signal: AbortSignal | undefined;
}

/** What a page reader returns. Markdown, because that is what a model reads. */
export interface ReadResult {
  readonly title: string | undefined;
  readonly markdown: string;
}

export interface ReadRequest {
  /** Already parsed and checked by `parseDestination`. */
  readonly url: string;
  readonly signal: AbortSignal | undefined;
}

export interface RetrievalProvider {
  /** Stable id: the credential key, the settings value, the name in a result. */
  readonly id: string;
  /** What a person sees in settings. */
  readonly name: string;
  /** Where to get a key, shown when there is no key. */
  readonly signupUrl: string;
}

export interface SearchProvider extends RetrievalProvider {
  search(request: SearchRequest): Promise<SearchResult>;
}

export interface ReaderProvider extends RetrievalProvider {
  read(request: ReadRequest): Promise<ReadResult>;
}

/** Builds a provider from its key. One per adapter, held in the registry. */
export type ProviderFactory<T extends RetrievalProvider> = (apiKey: string) => T;
