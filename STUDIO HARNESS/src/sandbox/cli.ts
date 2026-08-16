import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  ALL_APPLICATION_PACKAGES,
  ancestorsOf,
  grantTraverse,
  holdsTraverse,
} from "./isolation/index.js";
import {
  canInstall,
  elevationInstructions,
  installProfile,
  profileInstalled,
  profileLoaded,
  profileText,
  PROFILE_NAME,
  PROFILE_PATH,
  removeProfile,
} from "./isolation/linux/apparmor.js";
import { bwrapPath, probeContainment } from "./isolation/linux/bwrap.js";
import { unprivilegedIdentity } from "./isolation/linux/identity.js";
import { pastaPath, probeNetwork } from "./isolation/linux/network.js";
import { LocalSandbox } from "./local-sandbox.js";
import { createSandboxPolicy } from "./policy.js";

/**
 * `pnpm sandbox:release <project-directory>`
 *
 * Removes what containment put on the user's machine for one workspace: on
 * Windows, the permission entry on the project directory and the AppContainer
 * profile registered with the OS.
 *
 * ## Why this exists as a command
 *
 * Because the alternative was a method nobody calls. The runtime creates a
 * sandbox per project and has no shutdown hook to hang cleanup on, and adding
 * `release()` with no route to it would be a surface with no delivery path —
 * the exact shape of a defect already open in this project's register. A
 * command is small, it is honest about being manual, and it is reachable by the
 * one person who might actually want their ACL back.
 *
 * It is deliberately not automatic on exit. A profile deleted while another
 * Studio window is working in the same project would strip that window's
 * container mid-call, and "cleaned up correctly" is not worth that.
 */
/**
 * `pnpm sandbox:prepare [drive...]`
 *
 * Adds the one entry containment needs that an unelevated process cannot add:
 * traverse on the **system-owned** ancestors of a project — `C:\` and
 * `C:\Users` among them — for `ALL APPLICATION PACKAGES`. Without them a
 * contained program dies resolving its own path, because `realpath` stats every
 * component of it. See `windows/traversal.ts` for what a traverse entry grants
 * and, more importantly, what it does not.
 *
 * Only the ancestors that need elevation come here. Everything inside the
 * user's own folders is granted per workspace, automatically, and removed again
 * by `sandbox:release` — so this is one prompt for the machine rather than one
 * per project, which is the difference between a decision and a habit.
 */
/**
 * `sudo pnpm sandbox:prepare` on Linux, and `--undo` to reverse it.
 *
 * The same command name as Windows and a completely different job, which is the
 * point: what a user is told is "this machine needs one setup step", and the
 * mechanism behind it is ours to choose per platform. Windows adds a traverse
 * entry to system-owned directories; Linux installs an AppArmor profile so
 * `bwrap` may create a user namespace.
 *
 * Deliberately **not** `sysctl kernel.apparmor_restrict_unprivileged_userns=0`.
 * See `isolation/linux/apparmor.ts` — asking a user to weaken their kernel
 * machine-wide in order to switch a sandbox *on* is a trade this should never
 * offer, and it is one search result away from being the obvious fix.
 */
async function prepareLinux(undo: boolean): Promise<void> {
  let path: string;
  try {
    path = bwrapPath();
  } catch (error) {
    // Not installed at all. The resolver's message already names the package
    // and the command for the common distributions.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }

  // Optional on purpose. A machine without `passt` still contains programs; it
  // refuses to give them a network. Making setup fail here would block the
  // majority case — a project that never grants a child the network — on a
  // package it does not need.
  let stack: string | undefined;
  try {
    stack = pastaPath();
  } catch {
    stack = undefined;
  }

  if (undo) {
    if (!canInstall()) {
      process.stderr.write(`Removing ${PROFILE_PATH} needs root. Run: sudo pnpm sandbox:prepare --undo\n`);
      process.exitCode = 1;
      return;
    }
    // Two questions, because the answers come apart. What matters is what the
    // kernel is enforcing; the file only matters because it is how the profile
    // is named back to `apparmor_parser`.
    const onDisk = existsSync(PROFILE_PATH);
    const loaded = profileLoaded();

    if (!onDisk && !loaded) {
      process.stdout.write(`${PROFILE_PATH} is not installed. Nothing to remove.\n`);
      return;
    }

    if (!onDisk) {
      // The kernel is holding the profile and its file is gone — where an
      // earlier version of this command left machines, and where anyone who
      // deletes the file by hand lands. `apparmor_parser -R` reads the name out
      // of a file, so the file is written back in order to take the grant away.
      // Recovering a state we caused is worth six lines.
      writeFileSync(PROFILE_PATH, profileText(path, stack), "utf8");
    }

    try {
      removeProfile(() => rmSync(PROFILE_PATH, { force: true }));
    } catch (error) {
      // The file is deliberately still there. See `removeProfile`: unloading is
      // what actually stops the grant, and a file deleted after a failed unload
      // leaves the kernel holding a profile nothing can name until reboot.
      process.stderr.write(
        `Could not unload the profile from the kernel: ` +
          `${error instanceof Error ? error.message : String(error)}\n` +
          `${PROFILE_PATH} has been left in place so this can be retried — ` +
          `bubblewrap can still create a namespace until it succeeds.\n`,
      );
      process.exitCode = 1;
      return;
    }

    // Measured, not assumed — the same rule the install path follows, and the
    // reason this one exists at all.
    if (profileLoaded()) {
      process.stderr.write(
        `Removed ${PROFILE_PATH}, and the kernel is still enforcing the\n` +
          `${PROFILE_NAME} profile. Bubblewrap can still create a namespace.\n` +
          `A reboot clears it.\n`,
      );
      process.exitCode = 1;
      return;
    }

    process.stdout.write(
      `Unloaded the profile and removed ${PROFILE_PATH}. ` +
        `The sandbox will refuse work on this machine again.\n`,
    );
    return;
  }

  // Asked *about the user*, not about the asker. Under `sudo` those differ and
  // only one of them is the question: see `unprivilegedIdentity`, which exists
  // because probing as root made this command report success and install
  // nothing, on a machine where the user was still refused.
  const subject = unprivilegedIdentity(process.getuid?.(), process.env);
  const measured = subject === undefined ? "this account" : `uid ${subject.uid}`;

  // Both halves, because they fail independently. A machine where `bwrap` works
  // and `pasta` does not is a machine that contains programs and refuses to give
  // any of them a network — and reporting "nothing to do" there would be the
  // same half-truth the whole cycle is about.
  const contains = probeContainment(path, subject).ok;
  const networks = stack === undefined ? undefined : probeNetwork(stack, subject).ok;

  if (contains && networks !== false) {
    process.stdout.write(
      `The sandbox already works on this machine, measured as ${measured}. Nothing to do.\n`,
    );
    if (stack === undefined) process.stdout.write(`\n${networkPackageAdvice()}`);
    return;
  }

  if (!canInstall()) {
    process.stdout.write(elevationInstructions());
    process.exitCode = 1;
    return;
  }

  if (profileInstalled(path, stack)) {
    // The profile is ours, byte for byte, and something still fails. Saying
    // "installed" here would be the setup command reporting success while the
    // sandbox stays refused, which is the failure this whole cycle is about.
    const refused = contains
      ? `the network program still cannot build a namespace for ${measured}`
      : `bubblewrap still cannot create a namespace for ${measured}`;
    const detail = contains
      ? (stack === undefined ? undefined : probeNetwork(stack, subject).detail)
      : probeContainment(path, subject).detail;
    process.stderr.write(
      `${PROFILE_PATH} is already installed and ${refused}.\n` +
        `Something else on this machine is refusing it — a seccomp filter or a\n` +
        `container runtime are the usual causes. What the kernel said:\n` +
        `  ${detail ?? "(no detail)"}\n`,
    );
    process.exitCode = 1;
    return;
  }

  try {
    installProfile(path, stack, (text) => writeFileSync(PROFILE_PATH, text, "utf8"));
  } catch (error) {
    process.stderr.write(
      `Could not install ${PROFILE_PATH}: ` +
        `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Measured again rather than assumed. `apparmor_parser` exiting zero means the
  // profile parsed, not that the kernel now allows what we need — and the whole
  // argument of this stage is that those are different questions.
  const after = probeContainment(path, subject);
  if (!after.ok) {
    process.stderr.write(
      `Installed ${PROFILE_PATH}, and bubblewrap still cannot create a namespace\n` +
        `for ${measured}.\n` +
        `What the kernel said: ${after.detail ?? "(no detail)"}\n` +
        `Undo with: sudo pnpm sandbox:prepare --undo\n`,
    );
    process.exitCode = 1;
    return;
  }

  // Reported separately from containment, because a machine can end up with one
  // and not the other and the user needs to know which they have.
  if (stack !== undefined) {
    const network = probeNetwork(stack, subject);
    if (!network.ok) {
      process.stderr.write(
        `Installed ${PROFILE_PATH}. Bubblewrap contains, and the network program\n` +
          `still cannot build a namespace for ${measured}, so a contained program\n` +
          `will be refused a network rather than given the machine's.\n` +
          `What the kernel said: ${network.detail ?? "(no detail)"}\n`,
      );
      process.exitCode = 1;
      return;
    }
  }

  process.stdout.write(
    `Installed ${PROFILE_PATH} and verified that the sandbox now contains for ${measured}.\n` +
      (stack === undefined
        ? `Bubblewrap may create a user namespace; nothing else on this machine changed.\n`
        : `Bubblewrap and the network program may each create a user namespace;\n` +
          `nothing else on this machine changed.\n`) +
      `Undo with: sudo pnpm sandbox:prepare --undo\n`,
  );
  if (stack === undefined) process.stdout.write(`\n${networkPackageAdvice()}`);
}

/**
 * What to say on a machine that can contain but cannot narrow a network.
 *
 * Printed rather than treated as a failure, because containment is the part
 * most projects need and `passt` is only required by a child the operator
 * *grants* the network. Silence would be worse than either: the refusal would
 * arrive later, from a tool call, with no hint that a package fixes it.
 */
function networkPackageAdvice(): string {
  return (
    `One thing is missing. \`passt\` is not installed, so a contained program\n` +
    `cannot be given a network — it will be refused one rather than handed the\n` +
    `machine's own. Install it and run this again if you want that:\n` +
    `\n` +
    `  sudo apt install passt      # Debian, Ubuntu\n` +
    `  sudo dnf install passt      # Fedora, RHEL\n`
  );
}

async function prepare(targets: readonly string[]): Promise<void> {
  const paths = targets.length > 0 ? targets.map((target) => resolve(target)) : [process.cwd()];
  const seen = new Set<string>();
  let failed = false;

  for (const path of paths) {
    // The chain, not the volume root. The first version granted only the root,
    // which is what the *error message* named — and the next run failed on
    // `C:\Users`. An error reports the first wall, never the shape.
    //
    // The path itself is included, not only its ancestors. The runtime names
    // the exact directories it could not change, and a command that fixed
    // everything *above* what you named would be a command that never fixes
    // what you asked about.
    for (const ancestor of [...ancestorsOf(path), path]) {
      if (seen.has(ancestor)) continue;
      seen.add(ancestor);

      if (holdsTraverse(ancestor, ALL_APPLICATION_PACKAGES)) {
        process.stdout.write(`${ancestor} — already set up\n`);
        continue;
      }
      try {
        grantTraverse(ancestor, ALL_APPLICATION_PACKAGES);
        process.stdout.write(`${ancestor} — ready\n`);
      } catch (error) {
        // The advice is conditional on the failure, and that is not fussiness.
        // An earlier version said "run as administrator" for *every* failure,
        // and the first real failure was a timeout — from an already-elevated
        // terminal. Telling someone to do what they had already done cost a
        // round trip and pointed the investigation at the wrong wall.
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${ancestor} — failed: ${detail}\n`);
        if (detail.includes("error 5")) {
          process.stderr.write("  This needs a terminal opened as administrator.\n");
        }
        failed = true;
      }
    }
  }

  if (failed) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "prepare") {
    // Dispatched on the platform rather than on what the user typed. "This
    // machine needs one setup step" is the same sentence everywhere; only the
    // mechanism behind it differs, and asking the user to know which one they
    // are on would be leaking our implementation into their instructions.
    if (process.platform === "linux") {
      await prepareLinux(rest.includes("--undo"));
      return;
    }
    await prepare(rest);
    return;
  }

  const target = command;
  if (target === undefined || target.trim() === "") {
    process.stderr.write(
      process.platform === "linux"
        ? "Usage: sudo pnpm sandbox:prepare [--undo]\n" +
            "       pnpm sandbox:release <project-directory>\n"
        : "Usage: pnpm sandbox:prepare [project-directory...]\n" +
            "       pnpm sandbox:release <project-directory>\n",
    );
    process.exitCode = 2;
    return;
  }

  const workspaceRoot = resolve(target);
  const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot }));

  if (sandbox.isolationSupport.backend === undefined) {
    process.stdout.write(
      "Nothing to release: this machine has no sandbox backend, so nothing was granted.\n",
    );
    return;
  }

  await sandbox.releaseIsolation();
  process.stdout.write(`Released the sandbox for ${workspaceRoot}.\n`);
}

await main();
