import { existsSync, rmSync, writeFileSync } from "node:fs";

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

/**
 * `sudo pnpm sandbox:prepare` on Linux, and `--undo` to reverse it.
 *
 * The one setup step containment can need, and it is Linux's alone now: an
 * AppArmor profile so `bwrap` may create a user namespace. The Windows half
 * of this command - corridor entries on system-owned directories, read
 * entries on toolchains, a ledger of profiles to list and release - went
 * with the AppContainer backend (ADR 0057). On any other platform the
 * command says there is nothing to prepare.
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

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command !== "prepare") {
    process.stderr.write("Usage: sudo pnpm sandbox:prepare [--undo]\n");
    process.exitCode = 2;
    return;
  }

  if (process.platform !== "linux") {
    process.stdout.write(
      "Nothing to prepare: containment on this platform needs no setup step.\n" +
        "On Windows and macOS the permission gate is the boundary (ADR 0057);\n" +
        "the sandbox backend, and this command, are Linux's.\n",
    );
    return;
  }

  await prepareLinux(rest.includes("--undo"));
}

await main();
