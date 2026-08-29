import { join } from "node:path";

import { requestDirect } from "../../net/http.js";
import { cacheDirectory } from "../../platform/paths.js";
import { IconCache } from "./cache.js";
import { ProviderIconCatalog, cacheFor } from "./catalog.js";
import type { Fetcher } from "./source.js";
import { createModelsDevSource } from "./sources/models-dev.js";
import { createLobehubSource } from "./sources/lobehub.js";

export { ProviderIconCatalog } from "./catalog.js";
export { IconCache } from "./cache.js";
export type { IconSource, Fetcher } from "./source.js";

/**
 * The provider icon system, assembled.
 *
 * This file is the only place that knows which sources exist and what order
 * they are in. Everything above it holds a `ProviderIconCatalog` and calls
 * `get`; everything below it is one source minding its own business. Adding a
 * third source is a file in `sources/` and a line in the array here.
 *
 * ---- Why 24 hours ---------------------------------------------------------
 *
 * The TTL is on the *index* a source keeps, not on the icons. A logo that has
 * been fetched is kept until the cache directory is deleted, because a brand
 * mark does not change and re-downloading it daily would buy nothing. What
 * expires is the list of which ids exist, so a vendor added to models.dev
 * today is drawable tomorrow without a restart.
 */

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface ProviderIconsOptions {
  readonly cacheDir?: string;
  readonly fetcher?: Fetcher;
  readonly now?: () => number;
  readonly ttlMs?: number;
}

export function createProviderIcons(options: ProviderIconsOptions = {}): ProviderIconCatalog {
  const root = new IconCache(options.cacheDir ?? join(cacheDirectory(), "provider-icons"));
  const fetcher: Fetcher = options.fetcher ?? ((request) => requestDirect(request));
  const now = options.now ?? Date.now;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;

  return new ProviderIconCatalog([
    // First: uniform artwork, and 190 of the endpoints a connection can name.
    createModelsDevSource({ cache: cacheFor(root, "models-dev"), fetcher, now, ttlMs }),
    // Second: the model authors the first source has never heard of.
    createLobehubSource({ cache: cacheFor(root, "lobehub"), fetcher }),
  ]);
}
