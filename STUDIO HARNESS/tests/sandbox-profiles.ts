import { readdirSync } from "node:fs";
import { join } from "node:path";

import { invokeLauncher } from "../src/sandbox/isolation/windows/launcher.js";

/**
 * Deletes the AppContainer profiles the test run created, and only those.
 *
 * ## Why this is not test tidiness
 *
 * Containment on Windows registers a profile with the OS, keyed to the
 * workspace path. That is right in production — one per project, reused every
 * session, removed by `pnpm sandbox:release`. It is wrong for a test suite,
 * which runs in a fresh temporary directory every time: the first full run left
 * fourteen profiles behind on the machine, and every run would have left more.
 *
 * The finding is worth stating rather than quietly fixing. A per-workspace
 * resource is bounded only when workspaces are; anything that mints a new
 * workspace per run turns "one per project" into a leak.
 *
 * ## Why a difference and not a pattern
 *
 * The obvious version deletes everything matching `studio-*`. That would also
 * delete the profile of a real project the developer is working in, on the
 * machine they are working on, because the test suite happened to run. So the
 * set present *before* the run is recorded and left alone, and only what
 * appeared during it is removed.
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

export function teardown(): void {
  if (process.platform !== "win32") return;
  for (const name of present()) {
    if (before.has(name)) continue;
    try {
      invokeLauncher(["profile-delete", "--name", name]);
    } catch {
      // A profile that cannot be deleted is worth neither failing the suite nor
      // hiding: the next run's difference will show it as pre-existing, which
      // is the honest outcome.
    }
  }
}
