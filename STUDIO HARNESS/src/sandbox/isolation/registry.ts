import type { IsolationBackend, IsolationSupport } from "./backend.js";
import { selectIsolation } from "./backend.js";
import { linuxBwrap } from "./linux/bwrap.js";
import { windowsAppContainer } from "./windows/appcontainer.js";

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
 * a registry containing only a Windows backend, finds it unavailable, and
 * concludes that containment exists and this host is broken — when the truth is
 * that nobody has written the Linux half yet. Those are different sentences and
 * they deserve different behaviour.
 *
 * ## Both platforms are registered, and neither is thereby claimed
 *
 * Linux was absent here until Stage 4b step 3, so `ISOLATION_ENFORCED` was false
 * there and `execute` ran uncontained. It is present now, which means Linux
 * *enforces*: a machine whose `bwrap` cannot get a user namespace is refused
 * rather than run open. That distinction is not theoretical — it is the measured
 * state of stock Ubuntu 24.04, where `bwrap` is installed and the kernel still
 * says no. Registration says the implementation exists; only `available()` says
 * it works.
 *
 * macOS stays absent, and that is a decision rather than a gap: Stage 4b put it
 * explicitly out of scope, so a Mac gets `in-process` and no enforcement, the
 * same honest transitional state Linux had until now.
 */
const BACKENDS_BY_PLATFORM: Partial<Record<NodeJS.Platform, readonly IsolationBackend[]>> = {
  win32: [windowsAppContainer],
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
 * A function rather than a constant, deliberately. The Windows probe creates
 * and deletes a real AppContainer profile; doing that as a side effect of
 * *importing* a module would mean every test file, every CLI invocation and
 * every `tsx` script touched the machine's security state on load. It is
 * measured the first time something actually asks.
 */
export function hostIsolation(): IsolationSupport {
  measured ??= selectIsolation(OS_ISOLATION_BACKENDS);
  return measured;
}
