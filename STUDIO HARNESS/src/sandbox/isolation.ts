import { SandboxError } from "./errors.js";
import { satisfiesIsolation, type IsolationLevel } from "../contracts/effects.js";

/**
 * Which children need containment, and what the host can actually provide.
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
 * decided here, and not a flag each call site remembers to pass.
 *
 * The Harness itself is on 0039's list and deliberately not on this one: it is
 * the trusted process, and a process cannot contain itself.
 *
 * ## Why nothing is contained yet
 *
 * {@link OS_ISOLATION_BACKENDS} is empty. That is the true statement of where
 * meta-task #15 stands, and it is stated as data rather than as a comment so
 * that the code can act on it — see {@link ISOLATION_ENFORCED}, which cannot
 * stay false once a backend appears.
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

/**
 * A way of running a child under OS-enforced containment.
 *
 * Deliberately narrow. `available()` is a **probe**, not a declaration: on
 * Linux the backend is `bwrap`, which is an external binary that may simply not
 * be installed, and a backend that claims support it cannot deliver is worse
 * than no backend at all.
 */
export interface IsolationBackend {
  /** For diagnostics and for the error a shortfall produces. */
  readonly name: string;
  /** What this backend provides when it is available. */
  readonly level: IsolationLevel;
  /** Whether this host can use it right now. Measured, never assumed. */
  available(): boolean;
}

/**
 * Every OS-isolation backend this build knows about.
 *
 * **Empty, and that is the honest state.** Stage 4b step 2 adds the Windows
 * AppContainer backend and step 3 adds `bwrap`; until then the harness provides
 * `in-process` isolation only, which is what `LocalSandbox` has always claimed.
 *
 * Kept as a mutable-looking array with a `readonly` type so that adding a
 * backend is a one-line change here rather than an edit spread across the
 * factory, the sandbox and the tests.
 */
export const OS_ISOLATION_BACKENDS: readonly IsolationBackend[] = [];

/**
 * Whether a shortfall in isolation refuses the work.
 *
 * False today, and it has to be: with no backend registered, enforcing would
 * refuse every `execute` and `network` capability on every platform, which is
 * not a safer product — it is no product, and it would be a change made by a
 * constant rather than by a decision.
 *
 * It is not a comment or a TODO because those do not fail. It is **derived**
 * from the registry rather than set beside it, so there is no second switch to
 * forget: registering the first backend turns enforcement on by construction.
 *
 * `tests/unit/sandbox-isolation.test.ts` pins the transitional state itself —
 * that the registry is empty and nothing is contained — and fails the moment a
 * backend appears, which is the moment the documentation still claiming
 * containment has to be corrected (#41).
 */
export const ISOLATION_ENFORCED: boolean = OS_ISOLATION_BACKENDS.length > 0;

export interface IsolationSupport {
  /** The strongest level this host can actually provide. */
  readonly level: IsolationLevel;
  /** Which backend supplies it, or `undefined` for `in-process`. */
  readonly backend: string | undefined;
  /**
   * True when a required level above {@link IsolationSupport.level} is refused
   * rather than run anyway.
   */
  readonly enforcing: boolean;
}

/**
 * Measures what this host can provide, by probing rather than by platform name.
 *
 * A `process.platform === "linux"` check would claim `bwrap` on a machine that
 * does not have it installed — the exact failure mode ADR 0039's parity test
 * exists to prevent in the other direction. Names are not measurements.
 */
export function selectIsolation(
  backends: readonly IsolationBackend[] = OS_ISOLATION_BACKENDS,
): IsolationSupport {
  let best: IsolationBackend | undefined;
  for (const backend of backends) {
    if (!backend.available()) continue;
    if (best === undefined || satisfiesIsolation(backend.level, best.level)) {
      best = backend;
    }
  }

  if (best === undefined) {
    return {
      level: "in-process",
      backend: undefined,
      // A registered backend that no host can supply is a real refusal, not a
      // transitional one: the build believes containment exists and this
      // machine cannot give it.
      enforcing: backends.length > 0,
    };
  }

  return { level: best.level, backend: best.name, enforcing: backends.length > 0 };
}

/**
 * Refuses work whose required isolation this host cannot supply.
 *
 * This is where `unsupported_isolation` finally gets thrown (#32). It was
 * declared in `sandbox/errors.ts` and raised nowhere, left over from ADR 0034
 * and waiting for a decision that went the other way: the kind is not deleted,
 * it becomes the error a host with no usable backend produces.
 *
 * Returns a verdict instead of throwing when nothing is enforced, so callers
 * that only want to *describe* what they can do — the capability list the model
 * is shown — ask the same function as the caller that runs the work. One rule,
 * asked twice; two rules is what `T-28` was.
 */
export function assertIsolationAvailable(
  required: IsolationLevel,
  support: IsolationSupport,
): void {
  if (satisfiesIsolation(support.level, required)) return;
  if (!support.enforcing) return;

  throw new SandboxError("unsupported_isolation", {
    message:
      "This action needs OS-level isolation, and no sandbox backend on this " +
      "machine can provide it.",
  });
}

/**
 * Whether the required isolation is available, without the throw.
 *
 * The same question `assertIsolationAvailable` answers, for the places that
 * build a list rather than run a call.
 */
export function isolationAvailable(
  required: IsolationLevel,
  support: IsolationSupport,
): boolean {
  try {
    assertIsolationAvailable(required, support);
    return true;
  } catch {
    return false;
  }
}
