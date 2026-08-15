import { satisfiesIsolation, type IsolationLevel } from "../../contracts/effects.js";
import { SandboxError } from "../errors.js";
import type { SandboxPolicy } from "../policy.js";

/**
 * What a way of containing a child has to be able to do, and how the harness
 * decides which one it has.
 *
 * Deliberately narrow, and deliberately free of any platform name. The two
 * implementations behind this interface are a Windows AppContainer launcher we
 * build and a Linux `bwrap` the OS supplies; neither is named here, and a third
 * one would need no change to this file.
 */

/** A command as it would run with no containment at all. */
export interface ContainmentRequest {
  /** The roots the child may reach, and whether it may write to them. */
  readonly policy: SandboxPolicy;
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /**
   * Whether the child may reach the internet.
   *
   * A boolean, and platform-neutral on purpose. Windows expresses it as the
   * `internetClient` capability and Linux will express it as *not* unsharing
   * the network namespace; naming either one here would put a platform's
   * vocabulary in the interface every platform implements.
   *
   * **What it grants is not the same on both platforms, and saying otherwise
   * would be the easy lie here.**
   *
   * On Windows it is narrower than "network access", and that was measured
   * rather than assumed: with `internetClient` and nothing else, a contained
   * child reaches a public address and resolves a name, and is refused
   * `127.0.0.1` and `192.168.x.x` alike — both verified reachable from outside
   * the container in the same run, so the refusals are refusals and not
   * unreachable hosts. Loopback stays shut under *every* capability Windows
   * offers. So a contained server can call its API and cannot touch the user's
   * dev server, their database, or their router.
   *
   * On Linux the switch is `--share-net`, which means *no network namespace at
   * all* — so the child gets the host's stack, loopback and LAN included.
   * **Measured, not deduced:** against a server on `127.0.0.1`, a contained
   * child reaches it (`200`) with the network allowed and is refused
   * (`ECONNREFUSED`) without it. `bwrap` has no setting between "empty
   * namespace" and "the host's", so matching the Windows boundary needs a
   * firewall rule or a seccomp filter this does not have.
   *
   * So the refusal half is identical and complete on both platforms, and the
   * granted half is wider on Linux: a contained server there may call its API
   * *and* the user's dev server. Registered as **#93**, and stated here rather
   * than only in a document because this is the field whose name implies
   * otherwise.
   */
  readonly network: boolean;
  /**
   * Directories the child must be able to **read** to run at all — its own
   * program files. See `program-roots.ts` for why this is not covered by the
   * executable already being open.
   */
  readonly programRoots?: readonly string[];
}

/**
 * The same command, rewritten to run inside the container.
 *
 * A rewrite rather than a spawn, so the one place that starts processes stays
 * the one place that starts processes: timeouts, output limits and tree kills
 * are `runProcess`'s job and are not reimplemented per backend.
 */
export interface ContainedCommand {
  readonly executable: string;
  readonly args: readonly string[];
}

export interface IsolationBackend {
  /** For diagnostics and for the error a shortfall produces. */
  readonly name: string;
  /** What this backend provides when it is available. */
  readonly level: IsolationLevel;
  /**
   * Whether this host can use it right now. Measured, never assumed.
   *
   * A **probe**, not a declaration: on Linux the backend is `bwrap`, an
   * external binary that may simply not be installed, and on Windows the
   * launcher has to be present and the OS has to let an unelevated process
   * create a profile. A backend that claims support it cannot deliver is worse
   * than no backend at all.
   */
  available(): boolean;
  /**
   * One sentence saying why this host cannot use it, and what would fix it.
   *
   * Optional, and only consulted when {@link IsolationBackend.available} said
   * no. Without it a refusal reads "no sandbox backend on this machine can
   * provide it", which is true and useless — the Windows half of this feature
   * already learned that lesson the other way round, where naming the exact
   * folders and the exact command is what turned a dead end into a one-time
   * setup step.
   *
   * It must report what was **observed**, not what is likely. A guess in this
   * position sends the user to fix something that was never broken, which is
   * the failure ADR 0041's addendum is about.
   */
  diagnose?(): string | undefined;
  /** Prepares whatever the policy needs, and rewrites the command. */
  contain(request: ContainmentRequest): Promise<ContainedCommand>;
  /**
   * Undoes everything {@link IsolationBackend.contain} arranged on the user's
   * machine for this policy.
   *
   * Separate from `contain` because the two have genuinely different
   * lifetimes: containment is per call and this is per workspace. It exists
   * because the Windows backend writes permission entries into the user's own
   * project directory, and a feature that adds to a security descriptor
   * without ever removing anything is a feature that quietly grows.
   */
  release(policy: SandboxPolicy): Promise<void>;
}

export interface IsolationSupport {
  /** The strongest level this host can actually provide. */
  readonly level: IsolationLevel;
  /** Which backend supplies it, or `undefined` for `in-process`. */
  readonly backend: IsolationBackend | undefined;
  /**
   * True when a required level above {@link IsolationSupport.level} is refused
   * rather than run anyway.
   */
  readonly enforcing: boolean;
  /**
   * Why the backends this build has could not be used here, if they could not.
   *
   * Empty when containment is available, and empty when there was never a
   * backend for this platform — a machine that was never promised containment
   * has nothing to explain.
   */
  readonly shortfall: readonly string[];
}

/**
 * Measures what this host can provide, by probing rather than by platform name.
 *
 * A `process.platform === "linux"` check would claim `bwrap` on a machine that
 * does not have it installed — the exact failure mode ADR 0039's parity test
 * exists to prevent in the other direction. Names are not measurements.
 *
 * The registry it is given is a separate question and is answered in
 * `registry.ts`: *which backends this build has an implementation for* is
 * knowledge fixed at build time, and *whether one works here* is this function.
 */
export function selectIsolation(backends: readonly IsolationBackend[]): IsolationSupport {
  let best: IsolationBackend | undefined;
  const shortfall: string[] = [];
  for (const backend of backends) {
    if (!backend.available()) {
      // Collected on the way past, while the backend still remembers what it
      // saw. Asking afterwards would mean re-probing, and a probe that runs
      // twice is a probe whose two answers can differ.
      const reason = backend.diagnose?.();
      if (reason !== undefined) shortfall.push(reason);
      continue;
    }
    if (best === undefined || satisfiesIsolation(backend.level, best.level)) {
      best = backend;
    }
  }

  if (best === undefined) {
    return {
      level: "in-process",
      backend: undefined,
      // A registered backend that this host cannot supply is a real refusal,
      // not a transitional one: the build has containment for this platform and
      // this particular machine cannot give it.
      enforcing: backends.length > 0,
      shortfall,
    };
  }

  // Nothing to explain once something works, even if a second backend failed.
  return { level: best.level, backend: best, enforcing: backends.length > 0, shortfall: [] };
}

/**
 * Refuses work whose required isolation this host cannot supply.
 *
 * This is where `unsupported_isolation` gets thrown (#32). It was declared in
 * `sandbox/errors.ts` and raised nowhere, left over from ADR 0034 and waiting
 * for a decision that went the other way: the kind is not deleted, it becomes
 * the error a host with no usable backend produces.
 *
 * Returns without complaint when nothing is enforced, so callers that only want
 * to *describe* what they can do — the capability list the model is shown — ask
 * the same function as the caller that runs the work. One rule, asked twice;
 * two rules is what `T-28` was.
 */
export function assertIsolationAvailable(
  required: IsolationLevel,
  support: IsolationSupport,
): void {
  if (satisfiesIsolation(support.level, required)) return;
  if (!support.enforcing) return;

  throw new SandboxError("unsupported_isolation", {
    message: [
      "This action needs OS-level isolation, and no sandbox backend on this " +
        "machine can provide it.",
      ...support.shortfall,
    ].join(" "),
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
