import type { HttpRequestOptions } from "../../net/http.js";

/**
 * What a source found, and the distinction the whole cache depends on.
 *
 * `absent` and `unavailable` both mean "no SVG for you right now", and
 * collapsing them into one answer is a bug that hides for a long time: the
 * catalog remembers `absent` forever, so one lookup made while the network
 * was down would leave that vendor drawn as a letter until the process
 * restarted. Only the source knows which of the two happened, so only the
 * source can say.
 */
export type IconAnswer =
  | { readonly kind: "found"; readonly svg: string }
  /** This source genuinely has no mark for that id, and never will. */
  | { readonly kind: "absent" }
  /** The source could not be reached. Ask again later; remember nothing. */
  | { readonly kind: "unavailable" };

/**
 * What every icon source has to be, and nothing more.
 *
 * A source answers one question -- "do you have a monochrome mark for this
 * id?" -- and owns everything about how it answers: its own naming, its own
 * index, its own idea of what "absent" looks like on the wire. The catalog
 * above knows none of that. Adding a third source later means writing one of
 * these and adding it to the list in `index.ts`; it means touching nothing
 * else.
 *
 * A source never decides what is remembered -- it reports what happened and
 * the catalog decides, because only the catalog knows whether another source
 * might still answer.
 */
export interface IconSource {
  /** Names the source in cache paths and in `whichSource`. Stable. */
  readonly name: string;
  /**
   * What this source has for the id, monochrome when it has anything.
   *
   * Monochrome is a contract, not a coincidence. Every mark the app draws is
   * painted as a CSS mask over `currentColor`, so a source that returned
   * artwork with its own fills would render as a solid block. Both sources
   * here publish exactly that shape; a future one has to be checked.
   */
  get(id: string): Promise<IconAnswer>;
}

/** The fetch seam, so every source is testable without a network. */
export type Fetcher = (options: HttpRequestOptions) => Promise<{
  status: number;
  headers: Readonly<Record<string, string>>;
  body: string;
}>;

/** An id is also a filename in the cache, so its shape is a boundary. */
export const VALID_ID = /^[a-z0-9][a-z0-9._-]*$/;

/** Shared limits. A logo is small; anything large is not one. */
export const ICON_MAX_BYTES = 64 * 1024;
export const ICON_TIMEOUT_MS = 6_000;

/**
 * The vendor name inside an id that carries something else as well.
 *
 * OpenRouter marks a model's routing variants by prefixing the author with a
 * tilde -- `~anthropic`, `~openai` -- and the variant is a fact about routing,
 * not about whose logo the row wears. Normalising here rather than in each
 * source means a new source gets the behaviour for free.
 */
export function normalizeId(id: string): string {
  const trimmed = id.trim().toLowerCase();
  return trimmed.startsWith("~") ? trimmed.slice(1) : trimmed;
}
