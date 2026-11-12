import { gunzipSync } from "node:zlib";
import { StudioError } from "../../contracts/errors.js";
import { requestBinary } from "../../net/http.js";
import { observeOperation } from "../../observability/operation.js";

const ORIGIN = "https://tiles.openfreemap.org";
const MAX_BYTES = 2 * 1024 * 1024;
const CACHE_BYTES = 32 * 1024 * 1024;
const CACHE_ENTRIES = 256;
const CACHE_AGE_MS = 10 * 60 * 1000;
const MAX_PENDING = 32;

class BasemapError extends StudioError {
  readonly domain = "network";

  constructor() {
    super("basemap_unavailable", "The basemap is unavailable.", { retryable: true });
  }
}

interface Resource {
  readonly path: string;
  readonly kind: "tile" | "glyph";
  readonly mimeType: string;
}

/** The only inputs that reach the provider are canonical tile indices and font ranges. */
function resourceOf(path: string): Resource | null {
  const tile = /^tiles\/(\d{1,2})\/(\d{1,5})\/(\d{1,5})\.pbf$/.exec(path);
  if (tile !== null) {
    const z = Number(tile[1]);
    const x = Number(tile[2]);
    const y = Number(tile[3]);
    if (z > 14 || x >= 2 ** z || y >= 2 ** z) return null;
    return { path: `/planet/latest/${z}/${x}/${y}.pbf`, kind: "tile", mimeType: "application/vnd.mapbox-vector-tile" };
  }
  const glyph = /^glyphs\/(\d{1,5})-(\d{1,5})\.pbf$/.exec(path);
  if (glyph === null) return null;
  const from = Number(glyph[1]);
  const to = Number(glyph[2]);
  if (from % 256 !== 0 || to !== from + 255 || to > 65535) return null;
  return { path: `/fonts/Noto%20Sans%20Regular/${from}-${to}.pbf`, kind: "glyph", mimeType: "application/x-protobuf" };
}

type Asset = { readonly bytes: Buffer; readonly mimeType: string };
type Result = { readonly kind: "invalid" | "unavailable" } | { readonly kind: "asset"; readonly asset: Asset };

export class MapBasemap {
  readonly #cache = new Map<string, { readonly asset: Asset; readonly expiresAt: number }>();
  readonly #pending = new Map<string, Promise<Asset>>();
  #bytes = 0;

  constructor(private readonly request: typeof requestBinary = requestBinary) {}

  async read(path: string): Promise<Result> {
    const resource = resourceOf(path);
    if (resource === null) return { kind: "invalid" };
    const key = resource.path;
    const cached = this.#cache.get(key);
    if (cached !== undefined) {
      this.#cache.delete(key);
      if (cached.expiresAt > Date.now()) {
        this.#cache.set(key, cached);
        return { kind: "asset", asset: cached.asset };
      }
      this.#bytes -= cached.asset.bytes.byteLength;
    }
    let pending = this.#pending.get(key);
    if (pending === undefined) {
      if (this.#pending.size >= MAX_PENDING) return { kind: "unavailable" };
      pending = observeOperation("provider", "map.basemap.fetch", () => this.#fetch(resource), {
        provider: "openfreemap",
        resource: resource.kind,
      }).then((asset) => {
        this.#remember(key, asset);
        return asset;
      }).finally(() => this.#pending.delete(key));
      this.#pending.set(key, pending);
    }
    try {
      return { kind: "asset", asset: await pending };
    } catch {
      return { kind: "unavailable" };
    }
  }

  async #fetch(resource: Resource): Promise<Asset> {
    const reply = await this.request({
      url: ORIGIN + resource.path,
      author: "model",
      timeoutMs: 8_000,
      maxBytes: MAX_BYTES,
      maxRedirects: 0,
      headers: { accept: resource.mimeType, "accept-encoding": "identity" },
    });
    if (reply.status !== 200 || reply.headers["content-type"]?.split(";")[0] !== resource.mimeType) {
      throw new BasemapError();
    }
    // Some tile servers store gzip members on disk even when asked for identity.
    const compressed = reply.bytes[0] === 0x1f && reply.bytes[1] === 0x8b;
    const bytes = compressed ? gunzipSync(reply.bytes, { maxOutputLength: MAX_BYTES }) : reply.bytes;
    return { bytes, mimeType: resource.mimeType };
  }

  #remember(key: string, asset: Asset): void {
    this.#cache.set(key, { asset, expiresAt: Date.now() + CACHE_AGE_MS });
    this.#bytes += asset.bytes.byteLength;
    for (const [oldest, entry] of this.#cache) {
      if (this.#cache.size <= CACHE_ENTRIES && this.#bytes <= CACHE_BYTES) break;
      this.#cache.delete(oldest);
      this.#bytes -= entry.asset.bytes.byteLength;
    }
  }
}
