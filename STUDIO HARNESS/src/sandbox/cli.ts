import { existsSync, rmSync, writeFileSync } from "node:fs";

import { readLedger } from "./isolation/windows/ledger.js";
import { dirname, resolve } from "node:path";

import {
  ALL_APPLICATION_PACKAGES,
  ancestorsOf,
  grantCorridor,
  holdsRead,
  holdsCorridor,
  invokeLauncher,
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
import { createSandboxPolicy, gitConfigRoots } from "./policy.js";

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
 * `pnpm sandbox:prepare [project-directory...]`
 *
 * Adds the one entry containment needs that an unelevated process cannot add:
 * the corridor entry on the **system-owned** ancestors of a project - `C:\`
 * and `C:\Users` among them - for `ALL APPLICATION PACKAGES`. Without them a
 * contained program dies resolving its own path, because `realpath` stats every
 * component of it, and git dies resolving its working directory, because it
 * lists every component's parent. See `windows/traversal.ts` for what a
 * corridor entry grants and, more importantly, what it does not.
 *
 * **A machine prepared before the corridor entry existed must be prepared
 * again.** The earlier runs left a traverse-only entry on those two
 * directories; it is not enough for git, and `holdsCorridor` answers false for
 * it, so re-running this reports them as work to do rather than as already set
 * up. The re-grant rewrites that trustee's entry in place - it does not
 * accumulate a second one.
 *
 * Only the ancestors that need elevation come here. Everything inside the
 * user's own folders is granted per workspace, automatically, and removed again
 * by `sandbox:release` - so this is one prompt for the machine rather than one
 * per project, which is the difference between a decision and a habit.
 *
 * `--read <directory...>` is the other half of the same step (ADR 0047): read,
 * not traverse, on the directories a contained command's programs live in.
 * With no directories named it covers the one toolchain Studio depends on by
 * construction - the Node runtime this process runs on - and anything beyond
 * that is opt-in per machine. `--read --undo` takes those grants back, and
 * nothing else: it revokes that trustee's entry on the paths named or
 * defaulted, and touches no other entry in any descriptor it visits.
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

/**
 * `pnpm sandbox:prepare --read [directory...]`, and `--read --undo` to reverse.
 *
 * Read, not traverse, for `ALL APPLICATION PACKAGES` on the directories a
 * contained command's programs live in. A contained interpreter finds its
 * programs by walking the PATH it was granted, and can only find one in a
 * directory the container may read - so a toolchain under `C:\Program Files`
 * stays invisible to every contained command until this runs, however correct
 * the PATH is. The default set is the Node runtime this process runs on,
 * because Studio is a Node application and its runtime is the one toolchain it
 * depends on by construction; anything else is named by hand, per machine.
 */
async function prepareRead(targets: readonly string[], undo: boolean): Promise<void> {
  const paths =
    targets.length > 0
      ? targets.map((target) => resolve(target))
      : [dirname(process.execPath)];
  // Said only when the default was actually used. Keyed on what the caller
  // asked for rather than on what the default resolved to: a person who names
  // one directory by hand was told "no directories were named" about the
  // directory they had just typed, and told System32 was the Node runtime.
  const subject = targets.length === 0 ? paths[0] : undefined;
  if (subject !== undefined) {
    process.stdout.write(
      undo
        ? "No directories were named, so this revokes the grant on the Node\n" +
            `runtime this command runs on: ${subject}\n`
        : "No directories were named, so this covers the one toolchain Studio\n" +
            `depends on by construction: the Node runtime at ${subject}\n`,
    );
  }

  let failed = false;
  for (const path of paths) {
    if (undo) {
      try {
        invokeLauncher(["revoke", "--sid", ALL_APPLICATION_PACKAGES, "--path", path, "--mode", "read"]);
        process.stdout.write(`${path} — taken back\n`);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        process.stderr.write(`${path} — failed: ${detail}\n`);
        if (detail.includes("error 5")) {
          process.stderr.write("  This needs a terminal opened as administrator.\n");
        }
        failed = true;
      }
      continue;
    }

    if (holdsRead(path, ALL_APPLICATION_PACKAGES)) {
      process.stdout.write(`${path} — already set up\n`);
      continue;
    }
    try {
      invokeLauncher(["grant", "--sid", ALL_APPLICATION_PACKAGES, "--path", path, "--mode", "read"]);
      // Measured back, because a grant that exits zero and grants nothing is
      // the failure class this whole command exists to catch. One check, per
      // path, once: setup is not a hot path.
      if (!holdsRead(path, ALL_APPLICATION_PACKAGES)) {
        process.stderr.write(
          `${path} — the grant reported success and the container still cannot read it.\n`,
        );
        failed = true;
        continue;
      }
      process.stdout.write(`${path} — ready\n`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      process.stderr.write(`${path} — failed: ${detail}\n`);
      if (detail.includes("error 5")) {
        process.stderr.write("  This needs a terminal opened as administrator.\n");
      }
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
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

      if (holdsCorridor(ancestor, ALL_APPLICATION_PACKAGES)) {
        process.stdout.write(`${ancestor} — already set up\n`);
        continue;
      }
      try {
        grantCorridor(ancestor, ALL_APPLICATION_PACKAGES);
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

/**
 * `pnpm sandbox:list` — what containment has left on this machine.
 *
 * The half of #94 that was actually missing. Removal already worked and is
 * already correct; what a user had no way to do was *see* what existed. A
 * profile is named `studio-<sha256[0:32]>`, the hash cannot be inverted, and
 * nothing on the machine relates it back to a project — so "you have fourteen of
 * these" was information a person could not act on.
 *
 * Says what it does not know, rather than implying a completeness it cannot
 * have: this reads Studio's own record, so a profile minted before the record
 * existed does not appear. Claiming to be the machine's inventory would be the
 * more useful-sounding answer and the false one.
 *
 * Entries written before the corridor was recorded are marked, because on the
 * machine this defect was found on those are exactly the ones that leaked: a
 * release could not read what they had granted, so the ancestor entries stayed
 * while the profile went. The mark tells the user which listings deserve a
 * second look, not that anything is certainly still there.
 */
function listProfiles(): void {
  if (process.platform !== "win32") {
    // Not a stub. A Linux namespace evaporates with the process that held it,
    // which is why `release()` there is a genuine no-op — there is nothing to
    // list because nothing accumulates.
    process.stdout.write(
      "Nothing to list: containment on this platform leaves nothing behind.\n" +
        "A namespace ends with the process that held it.\n",
    );
    return;
  }

  const entries = [...readLedger()].sort((a, b) => a.createdAt - b.createdAt);
  if (entries.length === 0) {
    process.stdout.write("No sandbox profiles are recorded for this installation.\n");
    return;
  }

  process.stdout.write(
    `${entries.length} sandbox profile${entries.length === 1 ? "" : "s"}, ` +
      "one per project that has run a contained program:\n\n",
  );
  for (const entry of entries) {
    const gone = existsSync(entry.workspaceRoot) ? "" : "   (project directory is gone)";
    const when = new Date(entry.createdAt).toISOString().slice(0, 10);
    process.stdout.write(`  ${when}  ${entry.workspaceRoot}${gone}\n`);
    if (entry.traversed === undefined) {
      process.stdout.write(
        "         (no corridor recorded - this entry predates it, and is the\n" +
          "          kind that leaked ancestor entries on this machine. A release\n" +
          "          measures the workspace's own ancestors and revokes what its\n" +
          "          identity still holds there; grants outside that chain can\n" +
          "          only be found with `icacls <directory>`.)\n",
      );
    }
  }
  process.stdout.write(
    `\nRemove one with:  pnpm sandbox:release <project-directory>\n` +
      `Remove every one whose project is gone:  pnpm sandbox:release --stale\n` +
      `\nProfiles created before this list existed are not shown — it records what\n` +
      `Studio did, and is not an inventory of the machine.\n`,
  );
}

/**
 * `pnpm sandbox:release --stale` — release every profile whose project is gone.
 *
 * The one rule that is safe to apply in bulk without a reference count. A second
 * Studio window working in a project whose directory has been deleted is already
 * broken in a way this cannot make worse, whereas releasing a *live* project's
 * profile would strip that window's container mid-call — which is why nothing
 * does this on exit and why the bulk rule is this narrow rather than "all".
 */
async function releaseStale(): Promise<void> {
  const entries = readLedger().filter((entry) => !existsSync(entry.workspaceRoot));
  if (entries.length === 0) {
    process.stdout.write("Nothing to release: every recorded project still exists.\n");
    return;
  }

  let failed = false;
  for (const entry of entries) {
    const sandbox = new LocalSandbox(
      // The standing git-config roots ride along, so the file entries the
      // policy granted are taken back too rather than left to accumulate.
      createSandboxPolicy({ workspaceRoot: entry.workspaceRoot, readRoots: gitConfigRoots() }),
    );
    try {
      await sandbox.releaseIsolation();
      // The caveat matters on exactly the entries this command exists for. A
      // corridor-less entry releases with a measured sweep of the workspace's
      // own ancestors; anything granted outside that chain has no record and
      // no sweep, and saying "Released" with no qualification would hide it.
      const note = entry.traversed === undefined
        ? " (no corridor recorded: the workspace's own ancestors were measured and revoked where its identity still held them)"
        : "";
      process.stdout.write(`Released ${entry.workspaceRoot}${note}\n`);
    } catch (error) {
      // Reported and stepped over. One unremovable profile should not strand
      // the other thirteen, and the record keeps it visible for a retry.
      process.stderr.write(
        `${entry.workspaceRoot} — failed: ` +
          `${error instanceof Error ? error.message : String(error)}\n`,
      );
      failed = true;
    }
  }
  if (failed) process.exitCode = 1;
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  if (command === "list") {
    listProfiles();
    return;
  }

  if (command === "--stale") {
    await releaseStale();
    return;
  }

  if (command === "prepare") {
    // Dispatched on the platform rather than on what the user typed. "This
    // machine needs one setup step" is the same sentence everywhere; only the
    // mechanism behind it differs, and asking the user to know which one they
    // are on would be leaking our implementation into their instructions.
    const readMode = rest.includes("--read");
    const paths = rest.filter((entry) => entry !== "--read" && entry !== "--undo");
    if (process.platform === "linux") {
      if (readMode) {
        process.stdout.write(
          "--read is the Windows half of the setup step. On Linux, containment\n" +
            "is a namespace: nothing outside a mounted root is visible to a\n" +
            "contained program, so there is no per-directory grant to make.\n",
        );
        return;
      }
      await prepareLinux(rest.includes("--undo"));
      return;
    }
    if (readMode) {
      await prepareRead(paths, rest.includes("--undo"));
      return;
    }
    await prepare(paths);
    return;
  }

  const target = command;
  if (target === undefined || target.trim() === "") {
    process.stderr.write(
      process.platform === "linux"
        ? "Usage: sudo pnpm sandbox:prepare [--undo]\n" +
            "       pnpm sandbox:release <project-directory>\n"
        : "Usage: pnpm sandbox:prepare [project-directory...]\n" +
            "       pnpm sandbox:prepare --read [toolchain-directory...]\n" +
            "       pnpm sandbox:release <project-directory>\n" +
            "       pnpm sandbox:release --stale\n" +
            "       pnpm sandbox:list\n",
    );
    process.exitCode = 2;
    return;
  }

  const workspaceRoot = resolve(target);
  const sandbox = new LocalSandbox(
    // As above: the standing roots are part of the policy, so they are part
    // of what the release takes back.
    createSandboxPolicy({ workspaceRoot, readRoots: gitConfigRoots() }),
  );

  if (sandbox.isolationSupport.backend === undefined) {
    process.stdout.write(
      "Nothing to release: this machine has no sandbox backend, so nothing was granted.\n",
    );
    return;
  }

  // Read before the release, which forgets the entry as its last step. The
  // corridor field is the difference between "revoked from the record" and
  // "revoked from a measurement", and the user is entitled to know which
  // happened.
  const entry = readLedger().find((candidate) => candidate.workspaceRoot === workspaceRoot);
  await sandbox.releaseIsolation();
  process.stdout.write(`Released the sandbox for ${workspaceRoot}.\n`);
  if (entry !== undefined && entry.traversed === undefined) {
    process.stdout.write(
      "  (its ledger entry predates the corridor record: the workspace's own\n" +
        "   ancestors were measured and revoked where its identity still held\n" +
        "   them. Grants outside that chain have no record here.)\n",
    );
  }
}

await main();
