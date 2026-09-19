import type { IsolationBackend, IsolationSupport } from "./backend.js";
import { NO_ISOLATION, selectIsolation } from "./backend.js";
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
 * ## A third question since ADR 0057: does the person want it
 *
 * The gate is the boundary. A backend is an extra fence under it, never a
 * requirement, so the person turns it on (`preferIsolation`) and until they
 * do the harness behaves as if this build had no backend at all - no probe,
 * no fence, no sentence about containment in the prompt. Once it is on, the
 * registry is measured, and a machine that cannot supply the fence runs
 * gate-only with a note saying so, rather than refusing: a Linux host whose
 * kernel withholds a user namespace is in the same position as every Windows
 * host, which is a position the design accepts.
 *
 * ## Linux is registered; Windows and macOS are not, by decision
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
 * Whether this build has a backend for this platform at all.
 *
 * What a settings page asks before it offers the switch: on a platform with
 * nothing registered there is nothing to turn on, and the page says so
 * instead of showing a control that does nothing.
 */
export const ISOLATION_OFFERED: boolean = OS_ISOLATION_BACKENDS.length > 0;

/** @internal Cleared only by tests that need the probe to run again. */
let measured: IsolationSupport | undefined;

/** Whether the person has turned the fence on. Off until a setting says so. */
let wanted = false;

/**
 * Turns the fence on or off for this process.
 *
 * Process-wide, like `preferInterpreter`: the setting is the person's, read
 * from the store at startup and written back through the route, and every
 * sandbox built afterwards asks `hostIsolation()` and gets the answer that
 * matches. A sandbox built before the change keeps the support it was given.
 */
export function preferIsolation(on: boolean): void {
  wanted = on;
}

/**
 * Whether the fence is turned on, on a platform that has one to turn on.
 *
 * The switch is stored on every platform (a person's data directory may
 * travel), but on a platform with nothing registered it means nothing here:
 * no probe, no note, no sentence in the prompt.
 */
export function isolationWanted(): boolean {
  return wanted && ISOLATION_OFFERED;
}

/**
 * What this host can contain, measured once and then remembered.
 *
 * A function rather than a constant, deliberately. The Linux probe runs
 * `bwrap` to ask the kernel for a namespace; doing that as a side effect of
 * *importing* a module would mean every test file, every CLI invocation and
 * every `tsx` script spawned a process on load. It is measured the first
 * time something actually asks. Measured regardless of the switch, so a
 * settings page can say what turning the fence on would get.
 */
export function measuredIsolation(): IsolationSupport {
  measured ??= selectIsolation(OS_ISOLATION_BACKENDS);
  return measured;
}

/**
 * The isolation the harness runs commands under right now.
 *
 * The measured support when the fence is on, and none when it is off - and
 * "off" asks the registry nothing, so a machine that never wanted the fence
 * never spawns the probe.
 */
export function hostIsolation(): IsolationSupport {
  return isolationWanted() ? measuredIsolation() : NO_ISOLATION;
}
