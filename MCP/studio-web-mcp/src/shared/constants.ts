export const MCP_PROTOCOL_VERSION = "2026-07-28";

export const DEFAULTS = {
  search: { maxResults: 5, maxResultsMax: 20 },
  fetch: { maxChars: 20000, maxCharsMax: 100000, timeoutMs: 15000 },
  provider: { timeoutMs: 10000 },
} as const;

export const HEADERS = {
  REQUEST_ID: "x-request-id",
} as const;
