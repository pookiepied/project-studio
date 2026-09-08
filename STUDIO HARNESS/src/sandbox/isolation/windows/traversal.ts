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
 * ## What a corridor entry is
 *
 * Traverse, read-attributes, and `FILE_LIST_DIRECTORY`. Non-inheriting, so it
 * reaches nothing below the directory it is on.
 *
 * The listing bit was deliberately absent until it was measured to be the
 * reason git could not run at all: git's `getcwd` resolves its own working
 * directory by listing each component's parent, so with traverse alone every
 * contained git command died before it could look at a repository. The full
 * measurement, including why node never noticed, is in
 * `documentation/work/git-sandbox-findings.md`.
 *
 * What the extra bit gives away, stated rather than glossed: a holder can list
 * the corridor directories themselves, so on the users directory it learns the
 * account names on the machine and on the volume root the top-level folder
 * names. It cannot open any of them, and it cannot see one level further down,
 * because the entry does not inherit. The corridor is the chain of ancestors
 * of the child's own workspace - directories whose names it necessarily
 * already knows.
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

/**
 * Whether a trustee already holds the older, narrower traverse entry.
 *
 * Kept beside `holdsCorridor` for one reason: a machine prepared before the
 * corridor entry existed carries traverse-only entries on its two
 * system-owned ancestors, and those entries are still enough for everything
 * except git. Treating them as nothing would take a working sandbox away from
 * every such machine at once, in exchange for a fix the person has not been
 * asked for yet. So the corridor is attempted, and this is the floor that
 * decides whether falling short of it is fatal.
 */
export function holdsTraverse(path: string, sid: string): boolean {
  if (!launcherInstalled()) return false;
  try {
    invokeLauncher(["check", "--sid", sid, "--path", path, "--mode", "traverse"]);
    return true;
  } catch {
    return false;
  }
}

/** Whether a trustee already holds the corridor entry on a directory. Read-only. */
export function holdsCorridor(path: string, sid: string): boolean {
  if (!launcherInstalled()) return false;
  try {
    invokeLauncher(["check", "--sid", sid, "--path", path, "--mode", "corridor"]);
    return true;
  } catch {
    // `check` exits non-zero for "missing", which `invokeLauncher` raises. An
    // unreadable security descriptor and an absent entry both mean "not
    // traversable", and neither is worth a different answer here.
    return false;
  }
}

/**
 * Whether a trustee already holds read on a directory. Read-only.
 *
 * Asked with two trustees and never one: the workspace's own identity, or
 * `ALL APPLICATION PACKAGES` for the system-owned directories that carry the
 * machine-wide entry. The second is what makes a program directory check
 * answer "already readable" for `C:\Windows\System32` instead of attempting a
 * grant an unelevated runtime cannot make on a directory whose programs
 * already run - the check is an explicit-ACE scan, and an inherited entry is
 * in the DACL it scans, so the machine-wide answer is measurable without
 * writing anything.
 */
export function holdsRead(path: string, sid: string): boolean {
  if (!launcherInstalled()) return false;
  try {
    invokeLauncher(["check", "--sid", sid, "--path", path, "--mode", "read"]);
    return true;
  } catch {
    return false;
  }
}

export function grantCorridor(path: string, sid: string): void {
  invokeLauncher(["grant", "--sid", sid, "--path", path, "--mode", "corridor"]);
}

export function revokeCorridor(path: string, sid: string): void {
  // The mode matters on the way out too. Revoking with propagation on would
  // walk every file under the user's home folder to undo an entry that never
  // reached below one directory.
  invokeLauncher(["revoke", "--sid", sid, "--path", path, "--mode", "corridor"]);
}

export interface TraversalOutcome {
  /** Ancestors granted to this workspace, so `release` can take them back. */
  readonly granted: readonly string[];
  /** Ancestors that need `pnpm sandbox:prepare`, in root-first order. */
  readonly needsElevation: readonly string[];
  /**
   * Ancestors whose permission list refused a new entry because it is full.
   *
   * Split out from `needsElevation` because the two need opposite advice.
   * A system-owned directory is fixed by one setup command; a full permission
   * list is not fixed by running that command — the list has to shrink first,
   * which is what releasing recorded workspaces does. Sending a user whose
   * list is full to run `sandbox:prepare` sends them into a command that fails
   * the same way, which is precisely how this defect survived its first
   * cleanup attempts.
   */
  readonly refused: readonly string[];
}

/**
 * Whether a failed grant was refused because the directory's permission list
 * cannot hold another entry.
 *
 * The signature is the launcher's own message, which carries the Win32 status:
 * `could not build the new permissions for <path> (error 87)`. Status 87 is
 * `ERROR_INVALID_PARAMETER`, which is how `SetEntriesInAclW` reports a DACL
 * with no room for the merged entry — measured on a machine whose
 * user-directory DACL had reached the 64 KB hard limit, not read off a doc
 * page. Any other failure is the ordinary "cannot write here" and stays in
 * `needsElevation`.
 */
export function isFullPermissionList(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  // The closing parenthesis is part of the match on purpose: a substring test
  // for "error 87" also matches "error 870" and "error 8712", which are
  // different Win32 statuses with different answers. The launcher always
  // writes the status inside parentheses, so matching that is both narrower
  // and closer to the contract being relied on.
  return /\(error 87\)/.test(message);
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
  const refused: string[] = [];
  const seen = new Set<string>();

  for (const path of paths) {
    for (const ancestor of ancestorsOf(path)) {
      if (seen.has(ancestor)) continue;
      seen.add(ancestor);

      // Either identity satisfies it. The machine-wide entry is what
      // `sandbox:prepare` leaves behind, and re-granting per workspace on top
      // of it would be a second entry that says the same thing.
      if (holdsCorridor(ancestor, ALL_APPLICATION_PACKAGES)) continue;
      if (holdsCorridor(ancestor, workspaceSid)) {
        granted.push(ancestor);
        continue;
      }

      try {
        grantCorridor(ancestor, workspaceSid);
        granted.push(ancestor);
      } catch (error) {
        // Falling short of the corridor is not automatically a shortfall. A
        // machine prepared before the corridor entry existed holds traverse
        // here and nothing more, which is enough for every contained program
        // except git - so the old floor still counts as satisfied, and the
        // person is not locked out of their shell to buy a git fix they have
        // not been offered yet. `sandbox:prepare` is what offers it.
        if (
          holdsTraverse(ancestor, ALL_APPLICATION_PACKAGES) ||
          holdsTraverse(ancestor, workspaceSid)
        ) {
          continue;
        }
        // A system-owned directory, or a full list - not an error here, it is
        // the bucket, and the caller decides what each one means.
        if (isFullPermissionList(error)) {
          refused.push(ancestor);
        } else {
          needsElevation.push(ancestor);
        }
      }
    }
  }

  return { granted, needsElevation, refused };
}
