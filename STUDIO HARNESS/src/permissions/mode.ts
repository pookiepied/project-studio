import * as v from "valibot";

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
 *
 * Two modes since ADR 0057. There were three: Auto Edit sat between them and
 * drew a line between editing and running, and the line was drawn there
 * because running was what the OS container was for. Without the container
 * "edit without asking, ask before running" is an allow rule the person
 * writes from the approval dialog — this project, always — under Ask, not a
 * mode of its own. The rules the person wrote (`PermissionGrantStore`) apply
 * in both modes; the mode only says what happens to the `ask` no rule covers.
 */

export type ExecutionMode =
  /** Every default `ask` is asked. The safe default. */
  | "ask"
  /** Every default `ask` proceeds. Policy `ask` still asks. */
  | "auto";

const EXECUTION_MODES: readonly ExecutionMode[] = ["ask", "auto"];

/** Plain-English labels, for a UI and for a decision's `reason`. */
const DESCRIPTION: Record<ExecutionMode, string> = {
  ask: "Ask before anything that is not a plain read, unless a rule you wrote allows it.",
  auto: "Work without asking, except where a rule says otherwise.",
};

export function describeMode(mode: ExecutionMode): string {
  return DESCRIPTION[mode];
}

export function isExecutionMode(value: unknown): value is ExecutionMode {
  return typeof value === "string" && EXECUTION_MODES.includes(value as ExecutionMode);
}

/**
 * The mode on the wire.
 *
 * Built from `EXECUTION_MODES` rather than a second literal, so the vocabulary
 * the submission body, the conversation index, and the mode resolver accept is
 * one list in one file. These are the only names any wire value is validated
 * against; a caller that speaks another name - including the retired
 * `manual`, `auto-edit` and `full-auto` - is refused at the boundary, never
 * translated. A stored row in the old vocabulary was rewritten once, by
 * migration 25, in the safe direction.
 */
export const executionModeSchema = v.picklist(EXECUTION_MODES);

/**
 * Whether this mode may proceed without a person watching.
 *
 * Deliberately not asked of the effects: it is about *whether anyone is there*,
 * and in Auto nobody is. That is the whole reason the undo history has to be
 * working before Auto runs — the argument for it is "you can undo it", and an
 * Auto write with no snapshot behind it is exactly what that argument rules
 * out. See `T-09`.
 */
export function requiresUndo(mode: ExecutionMode): boolean {
  return mode === "auto";
}

/** Resolves a default `ask` under a mode. */
export function resolveAsk(mode: ExecutionMode): "allow" | "ask" {
  return mode === "auto" ? "allow" : "ask";
}
