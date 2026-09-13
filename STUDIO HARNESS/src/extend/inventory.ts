import { ExtendError } from "./errors.js";
import type { ExtensionSelectionStore, ResolutionContext, ScopeKind } from "./selection.js";

/**
 * What exists on this machine, and which of it this project chose.
 *
 * The other half of the spine. Three kinds of thing can be added to STUDIO, and
 * all three answer the same two questions — is it installed, and is it on for
 * this project. This file answers them once, for all of them.
 *
 * **It must never learn what a kind is.** No MCP type, no skill type, no hook
 * type appears here, and the architecture test enforces it. A kind registers a
 * function that lists what it has; the spine calls it and compares the answer
 * against the selection store. That is the entire relationship, and it is what
 * lets a fourth kind arrive by adding a folder and editing nothing.
 *
 * **It decides presence, never permission.** Nothing here is on the call path.
 * `CallGate` remains the only door, and an extension that is present still
 * needs approval for every call it makes. Hiding an unselected extension is
 * mechanical rather than a policy choice: an unselected server is never
 * connected, so its tools are never learned, so there is nothing to hide.
 */

/**
 * The three kinds of thing that can be added.
 *
 * Named here and understood nowhere. A connector is a remote MCP server with
 * OAuth and an icon, so it is `mcp`. A plugin is a bundle that does not exist
 * at runtime, so it is not a kind at all.
 */
export type ExtensionKind = "mcp" | "skill" | "hook";

export const EXTENSION_KINDS: readonly ExtensionKind[] = ["mcp", "skill", "hook"];

/**
 * The little a kind must say about one of its things.
 *
 * Deliberately thin. Anything richer would be the spine learning what a kind
 * is, one field at a time, and the first field that only one kind fills is the
 * moment this stops being shared.
 */
export interface ExtensionSummary {
  readonly id: string;
  /** For a settings screen. Never shown to a model. */
  readonly title: string;
  /**
   * Whether we wrote and reviewed it. Bundled things are `studio`, and this is
   * the same question `CapabilityProvenance.author` asks, on purpose — one
   * meaning, one word.
   */
  readonly author: "studio" | "third-party";
}

/** What a settings screen renders, and the only place the three states exist. */
export interface ExtensionState extends ExtensionSummary {
  readonly kind: ExtensionKind;
  /**
   * The answer that applies in this context, after inheritance. There is no
   * third rendered value: an extension that is not installed simply does not
   * appear, which is what "unlisted" meant, and a state you cannot render is
   * not a state.
   */
  readonly enabled: boolean;
  /**
   * Which scope produced `enabled`, absent when nothing had an opinion.
   *
   * A settings screen needs this to say why a row is on, and to tell the user
   * whether switching it off here overrides something wider or simply records
   * the first decision anyone has made about it.
   */
  readonly decidedAt?: ScopeKind;
}

/** What a kind provides: the things it has installed, in a stable order. */
export type ExtensionProvider = () => readonly ExtensionSummary[];

export class ExtensionInventory {
  readonly #providers = new Map<ExtensionKind, ExtensionProvider>();
  readonly #selection: ExtensionSelectionStore;

  constructor(selection: ExtensionSelectionStore) {
    this.#selection = selection;
  }

  /**
   * A kind says how to list what it has.
   *
   * One provider per kind, and registering a second is refused rather than
   * silently replacing the first. Two providers for `mcp` would mean two
   * answers to "what is installed", and the one that lost would be invisible.
   */
  register(kind: ExtensionKind, provider: ExtensionProvider): void {
    if (this.#providers.has(kind)) {
      throw new ExtendError("internal", {
        message: `Extensions of kind "${kind}" are already listed by something else.`,
      });
    }
    this.#providers.set(kind, provider);
  }

  /** Removes a kind's provider. The mirror of `register`, for teardown. */
  unregister(kind: ExtensionKind): boolean {
    return this.#providers.delete(kind);
  }

  /**
   * Everything installed of one kind, with the answer for this context.
   *
   * For a settings screen, which has to render what is switched off in order to
   * offer switching it on. A model never sees this.
   *
   * `decidedAt` rides along because a settings screen has to say more than on
   * or off: a row that is on because the user's default says so reads
   * differently from one that is on because this project asked for it, and
   * turning the first off from a project screen means something different than
   * turning the second off. Without provenance the screen cannot tell the user
   * which of those they are about to do.
   */
  list(kind: ExtensionKind, context: ResolutionContext): readonly ExtensionState[] {
    const provider = this.#providers.get(kind);
    if (!provider) return [];

    return provider().map((summary) => {
      const resolution = this.#selection.resolve(kind, summary.id, context);
      return {
        ...summary,
        kind,
        enabled: resolution.enabled,
        ...(resolution.decidedAt === undefined ? {} : { decidedAt: resolution.decidedAt }),
      };
    });
  }

  /** Everything installed, of every kind. */
  listAll(context: ResolutionContext): readonly ExtensionState[] {
    return EXTENSION_KINDS.flatMap((kind) => this.list(kind, context));
  }

  /**
   * What a project actually gets: installed, and switched on.
   *
   * The one question the runtime asks. Intersected with the provider's list
   * rather than read from the store alone, so a selection left behind by an
   * extension that has since been removed cannot bring back something that is
   * not there.
   */
  active(kind: ExtensionKind, context: ResolutionContext): readonly ExtensionState[] {
    return this.list(kind, context).filter((entry) => entry.enabled);
  }
}
