import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The one-time machine setup a Linux sandbox needs, and why it is not a sysctl.
 *
 * ## The problem
 *
 * Ubuntu 23.10 and later ship `kernel.apparmor_restrict_unprivileged_userns=1`,
 * which withholds user namespaces from unprivileged programs. `bwrap` needs one
 * to build a container, so on a stock install the sandbox probes unavailable and
 * every `shell` command and stdio MCP server is refused. Correct, and unusable —
 * measured on Ubuntu 24.04, where bubblewrap 0.9.0 is installed and still cannot
 * run.
 *
 * ## The fix we do not ship
 *
 * Telling the user to set that sysctl to `0`. It works, it is one line, and it
 * removes the protection **machine-wide, for every program on the system**, to
 * make one application work. An agent that asks its user to weaken their kernel
 * is doing the thing this whole sandbox exists to avoid, and it would be
 * especially absurd to ask for it *in order to* turn a sandbox on.
 *
 * ## The fix we do ship
 *
 * An AppArmor profile that grants the namespace to `bwrap` and nothing else.
 * This is not an invention: it is the mechanism Ubuntu built for exactly this
 * case, and `/etc/apparmor.d/` on a stock desktop already carries the same
 * profile for Brave, Chrome, VS Code, flatpak and others. Ours is a copy of
 * theirs, including the comment they use to explain what it is for.
 *
 * **What it costs, stated plainly.** `flags=(unconfined)` means the profile adds
 * no confinement of its own — it names the program and grants `userns`. So after
 * this, any program on the machine that can execute `/usr/bin/bwrap` can obtain
 * a user namespace through it. That is the same position every Ubuntu machine
 * was in before 23.10, and it is narrower than the sysctl by exactly one
 * program. It is a real trade and the installer says so rather than burying it.
 */

/** Where the profile lives. Fixed by AppArmor's own layout, not by us. */
export const PROFILE_PATH = "/etc/apparmor.d/studio-bwrap";

/** What the kernel calls it once loaded, which is not the same as where it lives. */
export const PROFILE_NAME = "studio-bwrap";

/**
 * Where the kernel lists what it is actually enforcing.
 *
 * Root-readable, one profile per line, and the only account of this that cannot
 * be out of date. Preferred over parsing `aa-status`, which is a program whose
 * output format is a courtesy rather than an interface.
 */
const LOADED_PROFILES = "/sys/kernel/security/apparmor/profiles";

/**
 * Whether the kernel is holding our profile right now.
 *
 * Asked separately from "is the file on disk" because those two answers come
 * apart, and the gap between them is where the grant hides. A file deleted by
 * hand — or by an earlier version of this command, which deleted before
 * unloading — leaves the profile loaded and enforcing with nothing on disk to
 * show for it. Reporting "not installed" in that state would be true about the
 * filesystem and false about the machine.
 */
export function profileLoaded(): boolean {
  try {
    return readFileSync(LOADED_PROFILES, "utf8")
      .split("\n")
      .some((line) => line.startsWith(`${PROFILE_NAME} `));
  } catch {
    // No AppArmor, or not root. Neither is a machine holding our profile.
    return false;
  }
}

/**
 * The profile text.
 *
 * A function of the `bwrap` path rather than a constant, because the resolver
 * finds the binary and a machine may not put it in `/usr/bin`. A profile
 * attached to the wrong path silently grants nothing, which is the worst
 * outcome available here: setup reports success and the sandbox stays refused.
 */
export function profileText(bwrapPath: string): string {
  return `# Project Studio's sandbox contains a program the model chose by putting it in
# a user namespace, which is what bubblewrap builds. Ubuntu 23.10 and later
# withhold namespaces from unprivileged programs unless a profile grants them.
#
# This is the same shape Ubuntu ships for Brave, Chrome and VS Code, and their
# comment applies here too: the profile allows everything and exists only to
# name the program and grant it the namespace. It is narrower than setting
# kernel.apparmor_restrict_unprivileged_userns=0, which would remove the
# restriction for every program on the machine.
#
# Written by \`pnpm sandbox:prepare\`. Remove with \`pnpm sandbox:prepare --undo\`.
abi <abi/4.0>,
include <tunables/global>

profile ${PROFILE_NAME} ${bwrapPath} flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/studio-bwrap>
}
`;
}

/** Whether the profile on disk is already the one we would write. */
export function profileInstalled(bwrapPath: string): boolean {
  try {
    return readFileSync(PROFILE_PATH, "utf8") === profileText(bwrapPath);
  } catch {
    return false;
  }
}

/**
 * Whether this process could write the profile itself.
 *
 * `getuid` is absent on Windows, hence the guard — and this module is only ever
 * reached on Linux, so the answer there is simply "are we root".
 */
export function canInstall(): boolean {
  return typeof process.getuid === "function" && process.getuid() === 0;
}

/**
 * Writes the profile and loads it.
 *
 * Throws rather than reporting, because the caller has to distinguish "you are
 * not root" — which has a next step — from "AppArmor rejected this", which does
 * not. Only ever called when {@link canInstall} is true.
 */
export function installProfile(bwrapPath: string, write: (text: string) => void): void {
  write(profileText(bwrapPath));
  // Loading is a separate act from writing, and skipping it is the failure mode
  // that looks like success: the file is there, the kernel has never read it,
  // and the sandbox stays refused until the next reboot.
  execFileSync("apparmor_parser", ["-r", PROFILE_PATH], { stdio: "ignore", timeout: 30_000 });
}

/**
 * Unloads the profile, and only then lets the caller delete it.
 *
 * **The order is the entire function.** `apparmor_parser -R` reads the file to
 * learn which profile to unload, so removing the file first leaves the kernel
 * holding a profile that can no longer be named — until the machine reboots.
 * The first version of this deleted first and swallowed the parser's failure,
 * and on Ubuntu 24.04 it printed "the sandbox will refuse work on this machine
 * again" while bubblewrap went on containing perfectly well. An undo that
 * reports success and undoes nothing is worse than one that fails loudly,
 * because the user stops looking.
 *
 * Throws rather than pressing on when the unload fails, which is why `remove`
 * is a callback and not something this does itself: the file has to survive a
 * failed unload, or the retry becomes impossible for the same reason.
 */
export function removeProfile(remove: () => void): void {
  execFileSync("apparmor_parser", ["-R", PROFILE_PATH], { stdio: "ignore", timeout: 30_000 });
  remove();
}

/**
 * The command a non-root user runs, printed rather than executed.
 *
 * Studio does not ask for a password and does not invoke `sudo` on the user's
 * behalf. A program that escalates its own privileges is a program the user has
 * to trust further than they agreed to, and the whole point of this file is that
 * the machine-wide change is a *decision* — so it is made in the user's own
 * shell, where they can read the profile first.
 */
export function elevationInstructions(): string {
  return (
    `Project Studio's sandbox needs one setup step on this machine.\n` +
    `\n` +
    `Bubblewrap is installed, and this kernel withholds user namespaces from\n` +
    `unprivileged programs, so the sandbox cannot build a container. The fix is\n` +
    `an AppArmor profile that grants the namespace to bubblewrap and nothing\n` +
    `else — the same mechanism Ubuntu ships for Brave, Chrome and VS Code.\n` +
    `\n` +
    `Run:\n` +
    `\n` +
    `  sudo pnpm sandbox:prepare\n` +
    `\n` +
    `That writes ${PROFILE_PATH} and loads it. Nothing else on the machine\n` +
    `changes, and no kernel setting is lowered.\n` +
    `\n` +
    `To undo it later: sudo pnpm sandbox:prepare --undo\n`
  );
}
