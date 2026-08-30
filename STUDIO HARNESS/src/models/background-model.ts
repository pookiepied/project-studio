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
 * adapters (`ModelProviderAdapter.backgroundModel`): the least expensive
 * model with working credentials, and the stable alias when nothing cheaper
 * is reachable.
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
 * the mistake ADR 0035 section 3 exists for. A process that never
 * bootstrapped (unit tests, a CLI that imports this module sideways) reads
 * as "nothing cheaper is known" and gets the alias at rank zero.
 */
export async function backgroundModelSpecifier(skip = 0): Promise<string | undefined> {
  const registry = bootstrappedModelRegistry();
  if (registry === undefined) {
    return skip === 0 ? STUDIO_MODEL_ID : undefined;
  }
  const specifier = await registry.backgroundModel(skip);
  if (specifier !== undefined) return specifier;
  return skip === 0 ? STUDIO_MODEL_ID : undefined;
}
