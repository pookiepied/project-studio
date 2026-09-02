import { STUDIO_MODEL_ID } from "../contracts/models.js";
import { bootstrappedModelRegistry } from "./bootstrap.js";

/**
 * The model a background agent runs on, as a specifier the run resolves.
 *
 * This is the shared half of "a small model does one job and returns a
 * value": any agent module that exists to produce one small answer - titling
 * today - asks this instead of naming a model itself, because the choice of
 * what to spend belongs to the model layer, which is the one place that
 * knows what is connected and what it costs. The policy lives on the
 * adapters (`ModelProviderAdapter.backgroundModel` and the ladder beside
 * it): the least expensive model with working credentials, and the stable
 * alias when nothing cheaper is reachable.
 *
 * `skip` steps down the ladder: a background run whose first candidate
 * failed (a gateway router whose listed price is not a price, a free tier
 * having a bad day) re-asks with `skip: 1` from a fresh instance, and the
 * next candidate takes the job. Undefined past rank zero means the ladder
 * is exhausted - the caller gives up rather than falling upward onto an
 * expensive model.
 *
 * The registry is the bootstrapped one, read through the module accessor and
 * never rebuilt - building a second model source to answer one question is
 * the mistake ADR 0035 section 3 exists for.
 *
 * ---- Why the read is synchronous, and what that costs ----------------------
 *
 * 1.0 resolved the ladder inside the agent's async initializer, one keychain
 * read per run. A Flue 2.0 agent function is synchronous and cannot await
 * anything, so the model layer maintains the answer instead: the ranked
 * ladder is computed by `refreshBackgroundLadder()` - awaited by the
 * composition root at boot, before the server can accept a dispatch - and
 * the render reads the held snapshot here. The cost is staleness between
 * refreshes: a provider connected after boot is named at the next refresh,
 * not immediately, which is honest for a snapshot the model layer owns and
 * the agent layer only reads. A process that never bootstrapped (unit tests,
 * a CLI that imports this module sideways) reads as "nothing cheaper is
 * known" and gets the alias at rank zero, exactly as 1.0 did.
 */
export function backgroundLadderSpecifier(skip: number): string | undefined {
  const registry = bootstrappedModelRegistry();
  if (registry === undefined) {
    return skip === 0 ? STUDIO_MODEL_ID : undefined;
  }
  return registry.backgroundLadder()[skip];
}

/**
 * Recomputes the ladder snapshot from live availability.
 *
 * Called by the composition root, once, awaited - so the uncomputed state
 * exists only before the server listens and never on a render's path. A
 * refresh that throws propagates: the caller decides whether that is fatal
 * (at boot it is not - titling is not on any turn's path, and an empty
 * ladder degrades the way 1.0's unreadable model layer always did, to the
 * alias, loudly logged).
 */
export async function refreshBackgroundLadder(): Promise<void> {
  await bootstrappedModelRegistry()?.refreshBackgroundLadder();
}
