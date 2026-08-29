import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { requestDirect, type HttpRequestOptions } from "../../net/http.js";
import { cacheDirectory } from "../../platform/paths.js";

/**
 * Real provider icons, from models.dev, cached on this machine.
 *
 * The webview's drawn marks are the offline floor; this library is how a
 * vendor with a real logo gets it. models.dev publishes one SVG per provider
 * at `logos/<id>.svg` and an api.json enumerating the ids; neither is fetched
 * at build time, so the catalog stays a build artifact and the icons stay a
 * cache.
 *
 * Three facts the implementation is built around, all measured:
 *
 * 1. models.dev serves a **generic placeholder SVG for ids it does not know**
 *    with HTTP 200 - the status cannot distinguish found from not found, so
 *    the placeholder body's hash is captured at manifest time and any logo
 *    matching it is treated as absent.
 * 2. ids are **close but not identical** to ours (`mistralai` vs `mistral`,
 *    `meta-llama` vs `meta`, `together-ai` vs `togetherai`), so lookups go
 *    through a small explicit alias table and everything else falls back.
 * 3. the whole thing is **derived, disposable data** - it lives under the
 *    Studio home's `cache/` directory, is refetched after a TTL, and losing
 *    it costs nothing but re-downloads.
 */

const MANIFEST_URL = "https://models.dev/api.json";
const LOGO_BASE = "https://models.dev/logos/";
const PLACEHOLDER_PROBE_ID = "studio-placeholder-probe";
const DEFAULT_MANIFEST_TTL_MS = 24 * 60 * 60 * 1000;
const FAILED_MANIFEST_RETRY_MS = 60 * 1000;
const MANIFEST_MAX_BYTES = 20 * 1024 * 1024;
const ICON_MAX_BYTES = 64 * 1024;
const ICON_TIMEOUT_MS = 6_000;

/**
 * models.dev ids our catalog names differently. Exact matches need no entry.
 *
 * Two different kinds of name arrive here, and the second is why this table
 * grew. A connection's `catalogProvider` is a *provider* - the company the
 * request is sent to - and those already read like models.dev's own ids. But
 * the marks beside model rows come from the model's *author*, which is the
 * first segment of an OpenRouter id, and authors are named for the lab rather
 * than the endpoint: `qwen`, `x-ai`, `meta-llama`. models.dev publishes logos
 * per provider only, so an author that is not also a provider resolved to the
 * placeholder and the picker drew a letter for a vendor whose logo was
 * already on disk under another name.
 *
 * Measured against OpenRouter's live model list: 58 distinct authors, 19 of
 * which are already models.dev ids. The entries below claim nine more.
 *
 * What is deliberately absent is as much of the point as what is here. An
 * alias is only written where the lab and the provider are the same company,
 * so the logo that comes back is the one the row is naming. ByteDance is the
 * case that fails that test - its endpoint is Volcengine, a different mark -
 * and Baidu, Writer, Liquid, AI21, Reka and the community fine-tuners have no
 * models.dev entry at all. Every one of those keeps its monogram, which says
 * "no logo" honestly rather than showing the wrong company's.
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

/** A models.dev id is also a filename here, so its shape is a boundary. */
const VALID_REMOTE_ID = /^[a-z0-9][a-z0-9._-]*$/;

/**
 * The vendor name inside an id that carries something else as well.
 *
 * OpenRouter marks a model's routing variants by prefixing the author with a
 * tilde - `~anthropic`, `~openai` - and the variant is a fact about routing,
 * not about whose logo the row wears. Stripping it here rather than adding
 * eight more alias entries also means a variant of a vendor added later
 * resolves without anyone remembering to write it down.
 */
function normalize(id: string): string {
  return id.startsWith("~") ? id.slice(1) : id;
}

export interface ProviderIconLibraryOptions {
  readonly cacheDir?: string;
  readonly fetcher?: (options: HttpRequestOptions) => Promise<{ status: number; headers: Readonly<Record<string, string>>; body: string }>;
  readonly now?: () => number;
  readonly manifestTtlMs?: number;
}

interface CachedManifest {
  readonly fetchedAt: number;
  /** The sha256 of the generic placeholder body served for unknown ids. */
  readonly placeholderHash: string;
  /** Every provider id models.dev named at manifest time. */
  readonly providers: readonly string[];
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export class ProviderIconLibrary {
  readonly #cacheDir: string;
  readonly #fetcher: (options: HttpRequestOptions) => Promise<{ status: number; headers: Readonly<Record<string, string>>; body: string }>;
  readonly #now: () => number;
  readonly #manifestTtlMs: number;
  readonly #manifestFile: string;
  #manifest: CachedManifest | undefined;
  #manifestReadAt = 0;
  #manifestFailedAt = 0;
  readonly #negative = new Set<string>();
  readonly #inflight = new Map<string, Promise<string | undefined>>();

  constructor(options: ProviderIconLibraryOptions = {}) {
    this.#cacheDir = options.cacheDir ?? join(cacheDirectory(), "provider-icons");
    this.#fetcher = options.fetcher ?? (options => requestDirect(options));
    this.#now = options.now ?? Date.now;
    this.#manifestTtlMs = options.manifestTtlMs ?? DEFAULT_MANIFEST_TTL_MS;
    this.#manifestFile = join(this.#cacheDir, "manifest.json");
  }

  /**
   * The SVG text for one provider or author id, or undefined when none is
   * known - which is the normal case for a self-hosted endpoint and for
   * vendors models.dev has never heard of, and is drawn as the custom mark.
   */
  async get(providerId: string): Promise<string | undefined> {
    const key = providerId.trim().toLowerCase();
    if (key.length === 0 || this.#negative.has(key)) return undefined;

    const base = normalize(key);
    const remoteId = ALIASES[base] ?? base;
    if (!VALID_REMOTE_ID.test(remoteId)) {
      this.#negative.add(key);
      return undefined;
    }

    const cached = this.#readCachedIcon(remoteId);
    if (cached !== undefined) return cached;

    const inflight = this.#inflight.get(key);
    if (inflight !== undefined) return inflight;

    const work = this.#download(key, remoteId).finally(() => {
      this.#inflight.delete(key);
    });
    this.#inflight.set(key, work);
    return work;
  }

  async #download(key: string, remoteId: string): Promise<string | undefined> {
    const manifest = await this.#ensureManifest();
    if (manifest === undefined) return undefined;
    if (!manifest.providers.includes(remoteId)) {
      this.#negative.add(key);
      return undefined;
    }

    let body: string;
    let contentType: string;
    try {
      const response = await this.#fetcher({
        url: `${LOGO_BASE}${remoteId}.svg`,
        author: "user",
        headers: { accept: "image/svg+xml" },
        timeoutMs: ICON_TIMEOUT_MS,
        maxBytes: ICON_MAX_BYTES,
      });
      if (response.status !== 200) return undefined;
      contentType = response.headers["content-type"] ?? "";
      if (!contentType.includes("svg")) return undefined;
      body = response.body;
    } catch {
      // A network failure is not a negative answer: nothing is remembered,
      // so the next request retries and an offline session that comes back
      // online heals without a restart.
      return undefined;
    }

    if (this.#hash(body) === manifest.placeholderHash) {
      this.#negative.add(key);
      return undefined;
    }

    this.#writeCachedIcon(remoteId, body);
    return body;
  }

  async #ensureManifest(): Promise<CachedManifest | undefined> {
    const now = this.#now();
    if (this.#manifest !== undefined && now - this.#manifestReadAt < this.#manifestTtlMs) {
      return this.#manifest;
    }
    if (now - this.#manifestFailedAt < FAILED_MANIFEST_RETRY_MS) {
      return this.#readManifestFromDisk();
    }

    try {
      const placeholder = await this.#fetcher({
        url: `${LOGO_BASE}${PLACEHOLDER_PROBE_ID}.svg`,
        author: "user",
        headers: { accept: "image/svg+xml" },
        timeoutMs: ICON_TIMEOUT_MS,
        maxBytes: ICON_MAX_BYTES,
      });
      const index = await this.#fetcher({
        url: MANIFEST_URL,
        author: "user",
        headers: { accept: "application/json" },
        timeoutMs: ICON_TIMEOUT_MS,
        maxBytes: MANIFEST_MAX_BYTES,
      });
      if (placeholder.status !== 200 || index.status !== 200) {
        this.#manifestFailedAt = now;
        return this.#readManifestFromDisk();
      }
      const parsed: unknown = JSON.parse(index.body);
      // The api.json body is one map: provider id -> provider record. The
      // ids are the whole of what this library needs from it.
      const providers = isRecord(parsed)
        ? Object.keys(parsed).filter((id): id is string => VALID_REMOTE_ID.test(id))
        : [];
      const manifest: CachedManifest = {
        fetchedAt: now,
        placeholderHash: this.#hash(placeholder.body),
        providers: providers.filter((id): id is string => VALID_REMOTE_ID.test(id)),
      };
      this.#writeManifestToDisk(manifest);
      this.#manifest = manifest;
      this.#manifestReadAt = now;
      return manifest;
    } catch {
      this.#manifestFailedAt = now;
      return this.#readManifestFromDisk();
    }
  }

  #readManifestFromDisk(): CachedManifest | undefined {
    if (this.#manifest !== undefined) return this.#manifest;
    if (!existsSync(this.#manifestFile)) return undefined;
    try {
      const parsed: unknown = JSON.parse(readFileSync(this.#manifestFile, "utf8"));
      if (!isRecord(parsed)) return undefined;
      const fetchedAt = parsed.fetchedAt;
      const placeholderHash = parsed.placeholderHash;
      const providers = parsed.providers;
      if (
        typeof fetchedAt !== "number" ||
        typeof placeholderHash !== "string" ||
        !Array.isArray(providers)
      ) {
        return undefined;
      }
      const manifest: CachedManifest = {
        fetchedAt,
        placeholderHash,
        providers: providers.filter((id): id is string => typeof id === "string"),
      };
      this.#manifest = manifest;
      this.#manifestReadAt = this.#now();
      return manifest;
    } catch {
      return undefined;
    }
  }

  #writeManifestToDisk(manifest: CachedManifest): void {
    this.#ensureDir();
    writeFileSync(this.#manifestFile, JSON.stringify(manifest), "utf8");
  }

  #iconFile(remoteId: string): string {
    return join(this.#cacheDir, `${remoteId}.svg`);
  }

  #readCachedIcon(remoteId: string): string | undefined {
    const file = this.#iconFile(remoteId);
    if (!existsSync(file)) return undefined;
    try {
      return readFileSync(file, "utf8");
    } catch {
      return undefined;
    }
  }

  #writeCachedIcon(remoteId: string, svg: string): void {
    this.#ensureDir();
    writeFileSync(this.#iconFile(remoteId), svg, "utf8");
  }

  #ensureDir(): void {
    if (!existsSync(this.#cacheDir)) {
      mkdirSync(this.#cacheDir, { recursive: true });
    }
  }

  #hash(text: string): string {
    return sha256(text);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
