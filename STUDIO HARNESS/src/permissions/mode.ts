import type { CapabilityDescriptor } from "../contracts/capabilities.js";
import { hasElevatedEffect } from "../contracts/effects.js";

/**
 * What `ask` means right now.
 *
 * A mode does not decide anything on its own. It resolves an `ask` the kernel
 * already arrived at, and only when that `ask` came from the **default** — the
 * fallback for a capability nobody has said anything about yet.
 *
 * An `ask` from a policy rule is never resolved by a mode. Policy `ask` means
 * "this is not a decision that may be automated", and a mode that could
 * override it would make every rule in `BASE_POLICY` advisory. That is the
 * invariant: modes widen the default, never the policy.
 */

export type ExecutionMode =
  /** Every unapproved call is asked about. The safe default. */
  | "manual"
  /** Reading and writing proceed. Running code and reaching the network ask. */
  | "auto-edit"
  /** Anything the policy left to the default proceeds. */
  | "full-auto";

export const EXECUTION_MODES: readonly ExecutionMode[] = [
  "manual",
  "auto-edit",
  "full-auto",
];

/** Plain-English labels, for a UI and for a decision's `reason`. */
const DESCRIPTION: Record<ExecutionMode, string> = {
  manual: "Ask before anything that is not a plain read.",
  "auto-edit": "Edit files without asking. Ask before running code.",
  "full-auto": "Work without asking, except where a rule says otherwise.",
};

export function describeMode(mode: ExecutionMode): string {
  return DESCRIPTION[mode];
}

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === "string" && EXECUTION_MODES.includes(value as ExecutionMode);
}

/**
 * Whether this mode may proceed without a person watching.
 *
 * Deliberately not asked of the effects: it is about *whether anyone is there*,
 * and in Full Auto nobody is. That is the whole reason the undo history has to
 * be working before Full Auto runs — the argument for it is "you can undo it",
 * and a Full Auto write with no snapshot behind it is exactly what that
 * argument rules out. See `T-09`.
 */
export function requiresUndo(mode: ExecutionMode): boolean {
  return mode === "full-auto";
}

/**
 * Resolves a default `ask` under a mode.
 *
 * Auto Edit is bounded by *effect*, not by provenance. Provenance is already
 * handled once, in `BASE_POLICY` — an untrusted capability with an elevated
 * effect gets a policy `ask`, which no mode touches. Checking it again here
 * would encode the same concern in two places that can drift apart, and the
 * one that drifts is always the copy.
 */
export function resolveAsk(
  mode: ExecutionMode,
  capability: CapabilityDescriptor,
): "allow" | "ask" {
  if (mode === "manual") return "ask";
  if (mode === "full-auto") return "allow";

  // Auto Edit is exactly "nothing elevated". Asked of the table rather than by
  // listing `read` and `write` here, so this cannot drift from what the sandbox
  // and the policy consider elevated. It is one meaning, in one place.
  return hasElevatedEffect(capability) ? "ask" : "allow";
}
