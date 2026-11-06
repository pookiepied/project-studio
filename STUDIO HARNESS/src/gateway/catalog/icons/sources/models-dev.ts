import { createHash } from "node:crypto";

import type { IconCache } from "../cache.js";
import {
  ICON_MAX_BYTES,
  ICON_RECHECK_AFTER_FAILURE_MS,
  ICON_TIMEOUT_MS,
  VALID_ID,
  type Fetcher,
  type IconAnswer,
  type IconSource,
} from "../source.js";

/**
 * models.dev -- the source for providers, which is what it is actually good at.
 *
 * Measured against its own manifest: 207 providers, a real logo for 190. That
 * is essentially every endpoint a connection can point at, which is why this
 * source is tried first and why nothing else comes close for the Providers
 * pane. Against model *authors* it is much weaker -- 25 of the 51 names that
 * reach a mark -- and that gap is what the second source exists to close.
 *
 * Two behaviours here are not obvious and both were measured:
 *
 * 1. It serves a **generic placeholder SVG for ids it does not know**, with
 *    HTTP 200. The status cannot distinguish found from not found, so the
 *    placeholder body's hash is captured at manifest time and any logo whose
 *    body matches it is treated as absent. Without this every unknown vendor
 *    would render an identical grey square that looks like a real answer.
 * 2. Its ids are close but not identical to ours, and in two different ways:
 *    a provider is named slightly differently (`mistralai` vs `mistral`), and
 *    a model author is often not a provider at all (`qwen` is Alibaba). Both
 *    go through one alias table.
 */

const MANIFEST_URL = "https://models.dev/api.json";
const LOGO_BASE = "https://models.dev/logos/";
const PLACEHOLDER_PROBE_ID = "studio-placeholder-probe";
const MANIFEST_MAX_BYTES = 20 * 1024 * 1024;
const MANIFEST_FILE = "manifest.json";

/**
 * models.dev ids our catalog names differently.
 *
 * Two kinds of name arrive. A connection's `catalogProvider` is a provider --
 * the company the request is sent to -- and those already read like
 * models.dev's own ids. The marks beside model rows come from the model's
 * author, the first segment of an OpenRouter id, and authors are named for
 * the lab rather than the endpoint: `qwen`, `x-ai`, `meta-llama`.
 *
 * An alias is only written where the lab and the provider are the same
 * company, so the logo that comes back is the one the row is naming.
 * ByteDance is the case that fails that test -- its endpoint is Volcengine, a
 * different mark -- and it is deliberately absent.
 */
const ALIASES: Readonly<Record<string, string>> = {
  mistralai: "mistral",
  "meta-llama": "meta",
  together: "togetherai",
  "together-ai": "togetherai",
  fireworks: "fireworks-ai",
  qwen: "alibaba",
  "x-ai": "xai",
  "z-ai": "zai",
  amazon: "amazon-bedrock",
  microsoft: "azure",
  "ibm-granite": "watsonx",
  tencent: "tencent-tokenhub",
  moonshot: "moonshotai",
  zhipu: "zai",
};

interface Manifest {
  readonly fetchedAt: number;
  /** The sha256 of the generic placeholder body served for unknown ids. */
  readonly placeholderHash: string;
  /** Every provider id models.dev named at manifest time. */
  readonly providers: readonly string[];
}

function isManifest(value: unknown): value is Manifest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.fetchedAt === "number" &&
    typeof record.placeholderHash === "string" &&
    Array.isArray(record.providers)
  );
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface ModelsDevOptions {
  readonly cache: IconCache;
  readonly fetcher: Fetcher;
  readonly now: () => number;
  readonly ttlMs: number;
}

export function createModelsDevSource(options: ModelsDevOptions): IconSource {
  const { cache, fetcher, now, ttlMs } = options;
  let manifest: Manifest | null | undefined;
  let manifestRequest: Promise<Manifest | undefined> | undefined;
  let retryManifestAt: number | undefined;

  async function ensureManifest(): Promise<Manifest | undefined> {
    if (manifest === undefined) manifest = cache.readJson(MANIFEST_FILE, isManifest) ?? null;
    const at = now();
    if (manifest !== null && at < manifest.fetchedAt + ttlMs) return manifest;
    if (manifestRequest !== undefined) return manifestRequest;
    if (retryManifestAt !== undefined && at < retryManifestAt) return undefined;

    manifestRequest = refreshManifest().then((fresh) => {
      manifestRequest = undefined;
      if (fresh === undefined) {
        retryManifestAt = now() + ICON_RECHECK_AFTER_FAILURE_MS;
      } else {
        manifest = fresh;
        retryManifestAt = undefined;
        cache.writeJson(MANIFEST_FILE, fresh);
      }
      return fresh;
    });
    return manifestRequest;
  }

  async function refreshManifest(): Promise<Manifest | undefined> {
    try {
      const [placeholder, index] = await Promise.all([
        fetcher({
          url: `${LOGO_BASE}${PLACEHOLDER_PROBE_ID}.svg`,
          author: "user",
          headers: { accept: "image/svg+xml" },
          timeoutMs: ICON_TIMEOUT_MS,
          maxBytes: ICON_MAX_BYTES,
        }),
        fetcher({
          url: MANIFEST_URL,
          author: "user",
          headers: { accept: "application/json" },
          timeoutMs: ICON_TIMEOUT_MS,
          maxBytes: MANIFEST_MAX_BYTES,
        }),
      ]);
      if (placeholder.status !== 200 || index.status !== 200) return undefined;
      const parsed: unknown = JSON.parse(index.body);
      // api.json is one map: provider id -> provider record. The ids are the
      // whole of what this source needs from it.
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return undefined;
      return {
        fetchedAt: now(),
        placeholderHash: sha256(placeholder.body),
        providers: Object.keys(parsed).filter((id) => VALID_ID.test(id)),
      };
    } catch {
      return undefined;
    }
  }

  return {
    name: "models-dev",
    async get(id: string): Promise<IconAnswer> {
      const remoteId = ALIASES[id] ?? id;
      if (!VALID_ID.test(remoteId)) return { kind: "absent", recheckAt: now() + ttlMs };

      const filename = `${remoteId}.svg`;
      const cached = cache.readIcon(filename);
      if (cached !== undefined && now() < cached.fetchedAt + ttlMs) {
        return { kind: "found", svg: cached.svg, recheckAt: cached.fetchedAt + ttlMs };
      }

      const unavailable = { kind: "unavailable", staleSvg: cached?.svg } as const;
      const index = await ensureManifest();
      if (index === undefined) return unavailable;
      const absent = { kind: "absent", recheckAt: index.fetchedAt + ttlMs } as const;
      if (!index.providers.includes(remoteId)) {
        if (cached !== undefined) cache.removeIcon(filename);
        return absent;
      }

      try {
        const response = await fetcher({
          url: `${LOGO_BASE}${remoteId}.svg`,
          author: "user",
          headers: { accept: "image/svg+xml" },
          timeoutMs: ICON_TIMEOUT_MS,
          maxBytes: ICON_MAX_BYTES,
        });
        if (response.status !== 200) return unavailable;
        if (!(response.headers["content-type"] ?? "").includes("svg")) {
          return unavailable;
        }
        // A listed provider can still serve the generic placeholder.
        if (sha256(response.body) === index.placeholderHash) {
          if (cached !== undefined) cache.removeIcon(filename);
          return absent;
        }
        cache.writeText(filename, response.body);
        return { kind: "found", svg: response.body, recheckAt: now() + ttlMs };
      } catch {
        return unavailable;
      }
    },
  };
}
