import { dirname, parse } from "node:path";

import { invokeLauncher, launcherInstalled } from "./launcher.js";

/**
 * Getting a contained program as far as its own first line.
 *
 * ## The wall, and why it is a chain rather than a door
 *
 * A program that resolves its own path calls `realpath`, and on Windows that
 * `lstat`s **every component** — `C:\`, then `C:\Users`, then each folder down
 * to the file. Node does it for every main module; most runtimes do it
 * somewhere. An AppContainer needs an explicit entry on each of those
 * directories to stat it, and by default it has none, so a contained
 * `node build.js` dies before its first line with an error naming a directory
 * nobody asked it to touch.
 *
 * This was found twice, which is the interesting part. The first fix granted
 * the volume root and looked complete — because `C:\` is what the error named.
 * The very next run named `C:\Users`. An error message reports the *first*
 * thing that failed, never the shape of the problem, and treating one as the
 * other is how a fix ships half-done.
 *
 * ## Two kinds of ancestor, and only one needs a prompt
 *
 * | Ancestor | Owner | Granted to | When |
 * |---|---|---|---|
 * | `C:\`, `C:\Users`, `C:\Program Files` … | the system | `ALL APPLICATION PACKAGES` | once, elevated, by `pnpm sandbox:prepare` |
 * | `C:\Users\you\…`, `D:\projects\…` | the user | **this workspace's own identity** | automatically, unelevated, on first use |
 *
 * The split is not cosmetic. A system directory cannot be written without
 * elevation, so it has to be a deliberate one-time act — and giving it to
 * `ALL APPLICATION PACKAGES` is what makes it *one* act instead of one per
 * project. Everything under the user's own folders needs no prompt at all, so
 * it is granted to the per-workspace SID instead: narrower, and `release()`
 * takes it away again.
 *
 * ## What a traverse entry is
 *
 * Traverse and read-attributes. **Not** `FILE_LIST_DIRECTORY` — the holder can
 * confirm the directory exists and walk through it, and cannot learn what is in
 * it. Non-inheriting, so it reaches nothing below. That is why it is acceptable
 * on `C:\Users`: it says "this folder exists", which the folder's own name
 * already said.
 */

/** `ALL APPLICATION PACKAGES` — every AppContainer on the machine. */
export const ALL_APPLICATION_PACKAGES = "S-1-15-2-1";

/**
 * Every strict ancestor of a path, from the volume root downwards.
 *
 * Root first, because that is the order the kernel checks them and the order a
 * failure will be reported in — a list that read leaf-first would make a
 * diagnostic message name the last wall instead of the first.
 */
export function ancestorsOf(path: string): readonly string[] {
  const { root } = parse(path);
  if (root === "") return [];

  const chain: string[] = [];
  let current = dirname(path);
  while (current !== root) {
    chain.push(current);
    const next = dirname(current);
    // `dirname` is its own fixed point at the root; without this a malformed
    // path spins forever rather than failing.
    if (next === current) break;
    current = next;
  }
  chain.push(root);
  return chain.reverse();
}

/** Whether a trustee already holds traverse on a directory. Read-only. */
export function holdsTraverse(path: string, sid: string): boolean {
  if (!launcherInstalled()) return false;
  try {
    invokeLauncher(["check", "--sid", sid, "--path", path, "--mode", "traverse"]);
    return true;
  } catch {
    // `check` exits non-zero for "missing", which `invokeLauncher` raises. An
    // unreadable security descriptor and an absent entry both mean "not
    // traversable", and neither is worth a different answer here.
    return false;
  }
}

export function grantTraverse(path: string, sid: string): void {
  invokeLauncher(["grant", "--sid", sid, "--path", path, "--mode", "traverse"]);
}

export function revokeTraverse(path: string, sid: string): void {
  // The mode matters on the way out too. Revoking with propagation on would
  // walk every file under the user's home folder to undo an entry that never
  // reached below one directory.
  invokeLauncher(["revoke", "--sid", sid, "--path", path, "--mode", "traverse"]);
}

export interface TraversalOutcome {
  /** Ancestors granted to this workspace, so `release` can take them back. */
  readonly granted: readonly string[];
  /** Ancestors that need `pnpm sandbox:prepare`, in root-first order. */
  readonly needsElevation: readonly string[];
}

/**
 * Makes every ancestor of every path statable, as far as it can without asking.
 *
 * Returns the shortfall rather than throwing, because the caller is the one
 * that knows whether a shortfall is fatal — and because the *list* is the
 * useful thing. "Run this command for these three directories" is actionable;
 * "access denied" is not.
 */
export function ensureTraversable(
  paths: readonly string[],
  workspaceSid: string,
): TraversalOutcome {
  const granted: string[] = [];
  const needsElevation: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    for (const ancestor of ancestorsOf(path)) {
      if (seen.has(ancestor)) continue;
      seen.add(ancestor);

      // Either identity satisfies it. The machine-wide entry is what
      // `sandbox:prepare` leaves behind, and re-granting per workspace on top
      // of it would be a second entry that says the same thing.
      if (holdsTraverse(ancestor, ALL_APPLICATION_PACKAGES)) continue;
      if (holdsTraverse(ancestor, workspaceSid)) {
        granted.push(ancestor);
        continue;
      }

      try {
        grantTraverse(ancestor, workspaceSid);
        granted.push(ancestor);
      } catch {
        // A system-owned directory. Not an error here — it is the list.
        needsElevation.push(ancestor);
      }
    }
  }

  return { granted, needsElevation };
}
