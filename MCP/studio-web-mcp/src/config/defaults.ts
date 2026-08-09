export const DEFAULTS = {
  SEARCH_PRIMARY: "tavily" as const,
  SEARCH_FALLBACK: "brave" as const,
  FETCH_PRIMARY: "jina" as const,
  FETCH_FALLBACK: "tavily" as const,
  TIMEOUT_MS: 10000,
  FETCH_TIMEOUT_MS: 15000,
  MAX_RESULTS: 5,
  MAX_CHARS: 20000,
  MAX_CHARS_MAX: 100000,
};
