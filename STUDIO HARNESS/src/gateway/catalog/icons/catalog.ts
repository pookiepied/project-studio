import { isRetiredProvider } from "../../retired-providers.js";
import type { IconCache } from "./cache.js";
import { ICON_RECHECK_AFTER_FAILURE_MS, VALID_ID, normalizeId, type IconSource } from "./source.js";

/**
 * The earliest expiry wins so an answer from a lower-priority source cannot
 * hide a new mark from a higher-priority source. On an outage, a known mark
 * can still be drawn while the catalog waits briefly to try that source again.
 */
export class ProviderIconCatalog {
  readonly #sources: readonly IconSource[];
  readonly #now: () => number;
  readonly #resolved = new Map<string, {
    readonly svg?: string;
    readonly source?: string;
    readonly recheckAt: number;
  }>();
  readonly #inflight = new Map<string, Promise<string | undefined>>();

  constructor(sources: readonly IconSource[], now: () => number) {
    this.#sources = sources;
    this.#now = now;
  }

  /**
   * The monochrome SVG for one provider or author id, or undefined when no
   * source has one -- the normal case for a self-hosted endpoint and for a
   * community fine-tune, both of which the webview draws as a letter.
   */
  async get(id: string): Promise<string | undefined> {
    const key = normalizeId(id);
    if (key.length === 0 || !VALID_ID.test(key) || isRetiredProvider(key)) return undefined;

    const hit = this.#resolved.get(key);
    if (hit !== undefined && this.#now() < hit.recheckAt) return hit.svg;

    const inflight = this.#inflight.get(key);
    if (inflight !== undefined) return inflight;

    const work = this.#resolve(key).finally(() => {
      this.#inflight.delete(key);
    });
    this.#inflight.set(key, work);
    return work;
  }

  /** Which source answered for an id, for diagnostics. Never a fetch. */
  whichSource(id: string): string | undefined {
    return this.#resolved.get(normalizeId(id))?.source;
  }

  async #resolve(key: string): Promise<string | undefined> {
    const previous = this.#resolved.get(key);
    let recheckAt = Infinity;
    for (const source of this.#sources) {
      let svg: string | undefined;
      const answer = await source.get(key);
      if (answer.kind === "unavailable") {
        recheckAt = Math.min(recheckAt, this.#now() + ICON_RECHECK_AFTER_FAILURE_MS);
        svg = answer.staleSvg ?? (previous?.source === source.name ? previous.svg : undefined);
      } else {
        recheckAt = Math.min(recheckAt, answer.recheckAt);
        if (answer.kind === "found") svg = answer.svg;
      }
      if (svg !== undefined) {
        this.#resolved.set(key, { svg, source: source.name, recheckAt });
        return svg;
      }
    }
    this.#resolved.set(key, { recheckAt });
    return undefined;
  }
}

/** A cache namespace per source, so two sources cannot collide on an id. */
export function cacheFor(root: IconCache, source: string): IconCache {
  return root.child(source);
}
