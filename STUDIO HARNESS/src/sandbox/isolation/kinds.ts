import type { IsolationLevel } from "../../contracts/effects.js";

/**
 * Which children need containment.
 *
 * ## The taxonomy is not new
 *
 * ADR 0039 already names the kinds of child process this system starts, and
 * gives each one an environment policy. Isolation belongs on that **same axis**.
 * Inventing a second taxonomy for it is precisely the mistake 0039 exists to
 * prevent — two lists of the same kinds, each internally consistent, drifting
 * apart in silence.
 *
 * | Kind | Who chose the program | Environment (0039) | Isolation |
 * |---|---|---|---|
 * | `tool` | us | `buildEnvironment()` | none — we wrote the call sites |
 * | `shell` | **the model** | `buildEnvironment()` | `os` |
 * | `mcp-server` | **a third party** | `buildEnvironment(declared)` | `os` |
 *
 * This distinction is load-bearing rather than tidy. `process/exec.ts`'s
 * `runProcess` is the single spawn point for the model's shell commands *and*
 * for the `git` calls the snapshot system depends on. Containing it wholesale
 * would take undo down with it, so the tier has to be a property of the kind,
 * decided here, and not a judgement each call site makes.
 *
 * The Harness itself is on 0039's list and deliberately not on this one: it is
 * the trusted process, and a process cannot contain itself.
 */

/**
 * A child, classified by who chose the program it runs.
 *
 * Provenance rather than behaviour, because that is what decides how much
 * containment is owed. A `git` invocation and a model-authored `git` invocation
 * do the same thing and are not the same risk.
 */
export type ChildKind = "tool" | "shell" | "mcp-server";

/**
 * What each kind must be contained by before we may honestly admit it.
 *
 * One table, and the only place that answers — the same discipline as
 * `contracts/effects.ts`, for the same reason.
 */
const ISOLATION_BY_KIND: Record<ChildKind, IsolationLevel> = {
  // First-party. The program, its arguments and its call site were all written
  // and reviewed by us; containment here buys nothing and costs the snapshot
  // system, which runs `git` through the same spawn point.
  tool: "in-process",
  shell: "os",
  "mcp-server": "os",
};

export function isolationForKind(kind: ChildKind): IsolationLevel {
  return ISOLATION_BY_KIND[kind];
}
