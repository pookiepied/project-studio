import type { IconCache } from "./cache.js";
import { VALID_ID, normalizeId, type IconSource } from "./source.js";

/**
 * One catalog over every icon source, and the only thing the app talks to.
 *
 * The shape this replaces had the webview reaching one source directly, which
 * worked for exactly as long as there was one. Adding a second would have
 * meant the frontend knowing which vendors live where, a second round trip on
 * every miss, and two caches with two expiry rules -- the duplication this
 * file exists to prevent.
 *
 * What happens instead: sources are asked in order and the first real answer
 * wins. The order is a quality decision, not a fallback chain. models.dev is
 * first because its marks are drawn on one uniform grid and it covers 190 of
 * the endpoints a connection can name; lobehub is second because it covers
 * the model authors models.dev has never heard of. Where both have a vendor,
 * first place keeps the column visually consistent.
 *
 * ---- What is remembered, and for how long ---------------------------------
 *
 * Three layers, and they answer different questions:
 *
 *   `#resolved`  this process, one map, so a picker drawing two hundred rows
 *                asks once rather than once per render
 *   the disk     per source, survives a restart, refetched after the TTL
 *   `#absent`    "no source has this", the answer for a third of the catalog
 *
 * The negative answer is the one that has to be cached as firmly as a success.
 * Most of OpenRouter's authors are individuals publishing fine-tunes and no
 * logo for them exists anywhere; without `#absent` every one of those rows
 * would re-ask both sources forever.
 *
 * A network failure is deliberately *not* remembered as absent. Sources return
 * undefined for both "I do not have it" and "I could not reach you", and only
 * this layer can tell the difference -- so it does not, and instead treats a
 * miss as absent only once every source has answered. An offline session
 * therefore heals when it comes back rather than needing a restart.
 */
export class ProviderIconCatalog {
  readonly #sources: readonly IconSource[];
  readonly #resolved = new Map<string, string>();
  readonly #absent = new Set<string>();
  readonly #inflight = new Map<string, Promise<string | undefined>>();

  constructor(sources: readonly IconSource[]) {
    this.#sources = sources;
  }

  /**
   * The monochrome SVG for one provider or author id, or undefined when no
   * source has one -- the normal case for a self-hosted endpoint and for a
   * community fine-tune, both of which the webview draws as a letter.
   */
  async get(id: string): Promise<string | undefined> {
    const key = normalizeId(id);
    if (key.length === 0 || !VALID_ID.test(key)) return undefined;

    const hit = this.#resolved.get(key);
    if (hit !== undefined) return hit;
    if (this.#absent.has(key)) return undefined;

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
    return this.#origin.get(normalizeId(id));
  }

  readonly #origin = new Map<string, string>();

  async #resolve(key: string): Promise<string | undefined> {
    let everyoneAnswered = true;
    for (const source of this.#sources) {
      const answer = await source.get(key);
      if (answer.kind === "found") {
        this.#resolved.set(key, answer.svg);
        this.#origin.set(key, source.name);
        return answer.svg;
      }
      // One unreachable source is enough to make "nobody has this" a guess
      // rather than a fact, so the whole lookup stays forgettable.
      if (answer.kind === "unavailable") everyoneAnswered = false;
    }
    if (everyoneAnswered) this.#absent.add(key);
    return undefined;
  }
}

/** A cache namespace per source, so two sources cannot collide on an id. */
export function cacheFor(root: IconCache, source: string): IconCache {
  return root.child(source);
}
