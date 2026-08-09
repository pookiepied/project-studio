import { ErrorCodes } from "../../errors/codes.js";
import { StudioError } from "../../errors/error.js";
import { shouldFallback } from "../../errors/normalize.js";
import type { ProviderConfig } from "../../config/env.js";
import { assertProviderConfigured } from "../../config/env.js";
import { createJinaFetchProvider } from "../../providers/fetch/jina/client.js";
import { createTavilyExtractProvider } from "../../providers/fetch/tavily/client.js";
import type { NormalizedFetchResponse } from "../../providers/fetch/types.js";
import { validateFetchUrl } from "../../validation/url.js";
import { applyBounds } from "./content.js";

export interface FetchRuntimeInput {
  url: string;
  max_chars?: number;
  offset?: number;
  format?: string;
}

function resolveProvider(name: string, cfg: ProviderConfig) {
  const n = name.toLowerCase();
  if (n === "jina") return createJinaFetchProvider(cfg.jinaKey);
  if (n === "tavily") {
    assertProviderConfigured("tavily", cfg);
    return createTavilyExtractProvider(cfg.tavilyKey!);
  }
  throw new StudioError(ErrorCodes.PROVIDER_NOT_CONFIGURED, `Unknown fetch provider "${name}"`, 500);
}

export async function executeFetch(
  input: FetchRuntimeInput,
  cfg: ProviderConfig,
): Promise<NormalizedFetchResponse & { metadata?: unknown }> {
  // Validate URL first — never fallback on invalid URL
  const validated = validateFetchUrl(input.url);
  const maxChars = Math.min(input.max_chars ?? 20000, 100000);
  const offset = input.offset ?? 0;

  const primaryName = cfg.fetchPrimary ?? "jina";
  const fallbackName = cfg.fetchFallback ?? "tavily";

  const primary = resolveProvider(primaryName, cfg);

  let res: NormalizedFetchResponse;
  try {
    res = await primary.fetch({ url: validated.toString(), max_chars: maxChars, offset });
  } catch (e) {
    if (e instanceof StudioError && (e.code === ErrorCodes.INVALID_URL || e.code === ErrorCodes.PROVIDER_NOT_CONFIGURED || e.code === ErrorCodes.AUTH_FAILED)) {
      throw e;
    }
    if (!shouldFallback(e)) throw e;
    if (fallbackName.toLowerCase() === primaryName.toLowerCase()) throw new StudioError(ErrorCodes.FETCH_FAILED, `Fetch failed`, 502);

    try {
      const fallback = resolveProvider(fallbackName, cfg);
      res = await fallback.fetch({ url: validated.toString(), max_chars: maxChars, offset });
    } catch (e2) {
      if (e2 instanceof StudioError) throw e2;
      throw new StudioError(ErrorCodes.FETCH_FAILED, `Fetch failed`, 502);
    }
  }

  // Bound content at edge — never return unbounded 100k+ tokens
  const bounded = applyBounds(res, offset, maxChars);
  return bounded;
}
