import { readdirSync } from "node:fs";
import { join } from "node:path";

import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { windowsAppContainer } from "../../src/sandbox/isolation/windows/appcontainer.js";
import { invokeLauncher } from "../../src/sandbox/isolation/windows/launcher.js";
import { readLedger } from "../../src/sandbox/isolation/windows/ledger.js";

/**
 * Takes back, at the end of the run, what the run put on the machine.
 *
 * ## Why this is not test tidiness
 *
 * Containment on Windows registers a profile with the OS, keyed to the
 * workspace path, and grants traverse entries on the workspace's ancestor
 * directories — the user's home folder among them. That is right in production:
 * one per project, reused every session, removed by `pnpm sandbox:release`. It
 * is wrong for a test suite, which runs in a fresh temporary directory every
 * time. The first full run left fourteen profiles behind on the machine, and
 * the ancestor entries behind with them — the profiles were deleted by the
 * first version of this teardown, but the ancestor entries were not, because
 * the only place that knew which ancestors had been granted was the memory of
 * a process that had already exited. Six hundred and ten entries accumulated
 * that way in three days, until the user's home-directory permission list was
 * physically full and containment stopped working.
 *
 * The finding is worth stating rather than quietly fixing. A per-workspace
 * resource is bounded only when workspaces are; anything that mints a new
 * workspace per run turns "one per project" into a leak. So the teardown
 * releases through the same `release()` a user's `sandbox:release` runs —
 * grants, corridor and profile, keyed off the ledger record the containment
 * wrote at mint time — rather than only deleting the profile.
 *
 * ## Why a difference and not a pattern
 *
 * The obvious version releases everything matching `studio-*`. That would also
 * release the profile of a real project the developer is working in, on the
 * machine they are working on, because the test suite happened to run. So the
 * set present *before* the run is recorded and left alone, and only what
 * appeared during it is released.
 */

const PACKAGES = process.env.LOCALAPPDATA === undefined
  ? undefined
  : join(process.env.LOCALAPPDATA, "Packages");

/** Names this backend produces: `studio-` and a truncated SHA-256. */
const OURS = /^studio-[0-9a-f]{32}$/;

function present(): Set<string> {
  if (process.platform !== "win32" || PACKAGES === undefined) return new Set();
  try {
    return new Set(readdirSync(PACKAGES).filter((entry) => OURS.test(entry)));
  } catch {
    return new Set();
  }
}

let before = new Set<string>();

export function setup(): void {
  before = present();
}

export async function teardown(): Promise<void> {
  if (process.platform !== "win32") return;
  for (const name of present()) {
    if (before.has(name)) continue;

    // This process never contained these workspaces — they were minted in the
    // test workers — so `release` runs the fresh-process path: identity from
    // the profile, corridor from the ledger record. That path is what a
    // user's `pnpm sandbox:release --stale` runs, which makes every suite run
    // an exercise of it rather than a promise about it.
    const entry = readLedger().find((record) => record.name === name);
    if (entry === undefined) {
      // No record means the corridor cannot be attributed, and guessing is
      // exactly what must not happen. Delete the profile as before, and say
      // what was not done: the entries may remain on the workspace's ancestors.
      try {
        invokeLauncher(["profile-delete", "--name", name]);
        process.stderr.write(
          `[sandbox-teardown] ${name} has no ledger record, so no corridor ` +
            `was revoked for it.\n`,
        );
      } catch {
        // A profile that cannot be deleted is worth neither failing the suite
        // nor hiding: the next run's difference will show it as pre-existing,
        // which is the honest outcome.
      }
      continue;
    }

    try {
      await windowsAppContainer.release(
        createSandboxPolicy({ workspaceRoot: entry.workspaceRoot }),
      );
    } catch (error) {
      // Reported and stepped over, as a single unreleaseable workspace is not
      // worth failing the suite for — but the profile is still deleted, so the
      // run leaves no more behind than the old teardown did. What may remain
      // is the corridor, and the message says so rather than leaving silence
      // that reads as success.
      process.stderr.write(
        `[sandbox-teardown] ${entry.workspaceRoot} — ${error instanceof Error ? error.message : String(error)}\n` +
          `[sandbox-teardown] Ancestor entries may remain for this workspace.\n`,
      );
      try {
        invokeLauncher(["profile-delete", "--name", name]);
      } catch {
        // As above: visible on the next run as pre-existing.
      }
    }
  }
}
