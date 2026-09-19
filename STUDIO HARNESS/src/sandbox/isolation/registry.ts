import type { IsolationBackend, IsolationSupport } from "./backend.js";
import { selectIsolation } from "./backend.js";
import { linuxBwrap } from "./linux/bwrap.js";

/**
 * Which containment backends **this build has an implementation for**, per
 * platform.
 *
 * ## Two different questions, kept apart
 *
 * This is not the availability check, and the difference is the whole reason
 * the file exists. *Does a backend exist for this platform in this build* is
 * knowledge fixed when the code was written, and it is what a platform key
 * answers. *Does it work on this machine* is a runtime measurement, and it is
 * what `IsolationBackend.available()` answers by actually trying.
 *
 * Conflating them in either direction is a bug with a history. Deciding
 * availability by platform name claims `bwrap` on a Linux box that never
 * installed it. Deciding build knowledge by probing means a Linux machine sees
 * an empty registry, finds nothing available, and concludes that containment
 * exists and this host is broken - when the truth is that nobody registered
 * a backend for it. Those are different sentences and they deserve different
 * behaviour.
 *
 * ## Linux is registered; Windows and macOS are not, by decision
 *
 * Linux *enforces*: a machine whose `bwrap` cannot get a user namespace is
 * refused rather than run open, which is the measured state of stock Ubuntu
 * 24.04, where `bwrap` is installed and the kernel still says no.
 * Registration says the implementation exists; only `available()` says it
 * works. (ADR 0057 makes this backend opt-in with a gate-only fallback; that
 * is a later step and this file still enforces until it lands.)
 *
 * Windows had an AppContainer backend from ADR 0041 until ADR 0057 removed
 * it. Containing a developer's shell in an AppContainer meant writing
 * permission entries onto the real filesystem for every workspace and every
 * ancestor down from the volume root, and those entries accumulated until
 * the ACLs they lived on could hold no more. So Windows has no backend, and
 * on Windows the permission gate is the boundary - the position every other
 * harness on the platform is in. A Windows or macOS fence, if one worth
 * having appears, is a new registration here and a new ADR.
 */
const BACKENDS_BY_PLATFORM: Partial<Record<NodeJS.Platform, readonly IsolationBackend[]>> = {
  linux: [linuxBwrap],
};

export const OS_ISOLATION_BACKENDS: readonly IsolationBackend[] =
  BACKENDS_BY_PLATFORM[process.platform] ?? [];

/**
 * Whether a shortfall in isolation refuses the work.
 *
 * **Derived** from the registry rather than set beside it, so there is no
 * second switch to forget: registering a backend for a platform turns
 * enforcement on there by construction, and removing the last one turns it off
 * again. It is not a comment or a TODO, because those do not fail.
 */
export const ISOLATION_ENFORCED: boolean = OS_ISOLATION_BACKENDS.length > 0;

/** @internal Cleared only by tests that need the probe to run again. */
let measured: IsolationSupport | undefined;

/**
 * What this host can contain, measured once and then remembered.
 *
 * A function rather than a constant, deliberately. The Linux probe runs
 * `bwrap` to ask the kernel for a namespace; doing that as a side effect of
 * *importing* a module would mean every test file, every CLI invocation and
 * every `tsx` script spawned a process on load. It is measured the first
 * time something actually asks.
 */
export function hostIsolation(): IsolationSupport {
  measured ??= selectIsolation(OS_ISOLATION_BACKENDS);
  return measured;
}
