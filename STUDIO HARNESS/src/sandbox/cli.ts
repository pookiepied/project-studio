import { resolve } from "node:path";

import {
  ALL_APPLICATION_PACKAGES,
  ancestorsOf,
  grantTraverse,
  holdsTraverse,
} from "./isolation/index.js";
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
    await prepare(rest);
    return;
  }

  const target = command;
  if (target === undefined || target.trim() === "") {
    process.stderr.write(
      "Usage: pnpm sandbox:prepare [project-directory...]\n" +
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
