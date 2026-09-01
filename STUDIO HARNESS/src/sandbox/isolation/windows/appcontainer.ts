import { createHash } from "node:crypto";
import { existsSync } from "node:fs";

import { SandboxError } from "../../errors.js";
import type { SandboxPolicy } from "../../policy.js";
import type {
  ContainedCommand,
  ContainmentRequest,
  IsolationBackend,
} from "../backend.js";
import {
  containArgs,
  invokeLauncher,
  launcherInstalled,
  launcherPath,
  type LauncherJoin,
} from "./launcher.js";
import {
  forgetProfile,
  readLedger,
  recordProfile,
  recordProgramRoots,
  recordTraversed,
} from "./ledger.js";
import {
  ALL_APPLICATION_PACKAGES,
  ancestorsOf,
  ensureTraversable,
  holdsRead,
  holdsTraverse,
  isFullPermissionList,
  revokeTraverse,
} from "./traversal.js";

/**
 * OS containment on Windows, using an AppContainer.
 *
 * ## Why this and not something better known
 *
 * Windows Sandbox and Hyper-V containers are Pro and Enterprise features. The
 * machine this was built and measured on is Windows 11 **Home**, which is the
 * most common consumer edition, and a design that does not run there does not
 * run for most users. AppContainer is a kernel token feature rather than an
 * edition feature, and creating a profile needs no elevation. That was
 * measured, not read.
 *
 * ## What it actually gives, measured
 *
 * From inside the container, against a real workspace:
 *
 * | Attempt | Result |
 * |---|---|
 * | Open, list and read a granted directory | allowed |
 * | Create a file in a **read**-granted directory | refused (error 5) |
 * | Create a file in a **write**-granted directory | allowed |
 * | Anything at all in an ungranted directory — the user's Documents, their home, another project | refused (error 5) |
 * | Reach the network (`curl https://…`) | refused; DNS does not resolve |
 *
 * ## The enumeration problem did not exist
 *
 * The spike recorded that a contained child could read a file but could not
 * `dir` the folder containing it, and that finding shaped this whole plan. It
 * was wrong. `cmd /c dir` fails inside a container for a reason of its own —
 * it cannot open the working directory it inherits — and reports it with the
 * same "Access is denied." the kernel uses. Asking the kernel directly, with
 * `studio-contain probe`, listing is allowed exactly when reading is. The
 * lesson is the standing one: a tool's error message is not a measurement.
 *
 * ## The programs still run
 *
 * A contained child cannot read `C:\Program Files\nodejs` — and `node.exe`
 * still runs, because the launcher opens the image with **its own** rights
 * before the container token is applied. So no grant is needed for the program
 * itself, and the child cannot go rummaging through its installation
 * afterwards. The limit that follows: a program that reads its own files at
 * runtime, rather than only linking system libraries, needs its directory
 * granted. Python's standard library is the example to expect.
 *
 * ## What it costs the user
 *
 * A permission entry on their project directory, for a SID that exists only for
 * this workspace. It is additive — every other entry is carried through
 * untouched — and `release()` removes it. It is still a real modification to
 * their disk, and ADR 0041 says so in those words.
 */

/** The one shape an AppContainer name may take, and a stable one per workspace. */
export function profileName(workspaceRoot: string): string {
  // Hashed rather than derived from the path text. Names are limited to 64
  // characters and reject most punctuation, and a workspace path is neither
  // short nor punctuation-free. The hash is also why two projects with the same
  // folder name do not share a container.
  const digest = createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 32);
  return `studio-${digest}`;
}

/** What has been arranged for one workspace, so it is arranged once. */
interface PreparedContainer {
  readonly sid: string;
  /** Absolute paths already granted, to keep repeat calls free. */
  readonly granted: Set<string>;
  /** Ancestors made statable for this workspace, so `release` can undo them. */
  readonly traversed: Set<string>;
  /**
   * Program directories granted read for this workspace, so `release` can
   * take them back even when the ledger write failed. Same rule as
   * `traversed`: the in-memory set is what this process did, the ledger is
   * the copy that outlives it.
   */
  readonly programRoots: Set<string>;
}

/**
 * A profile created only to answer "does this work here", then removed.
 *
 * Fixed name so a crashed run leaves at most one, and the next run reuses it
 * rather than accumulating.
 */
const PROBE_PROFILE = "studio-sandbox-probe";

class WindowsAppContainerBackend implements IsolationBackend {
  readonly name = "appcontainer";
  readonly level = "os" as const;

  /** Memoised because the probe creates and deletes a real profile. */
  #availability: boolean | undefined;
  readonly #prepared = new Map<string, PreparedContainer>();
  /**
   * Ancestors the one-time setup advice has already been given for, so a
   * containment that runs ten thousand times advises once and not ten thousand
   * times. Per directory rather than a single flag, because a workspace on
   * another drive is a shortfall the user has not been told about yet.
   */
  readonly #advised = new Set<string>();

  available(): boolean {
    if (this.#availability !== undefined) return this.#availability;
    this.#availability = this.#measure();
    return this.#availability;
  }

  /**
   * Creates a throwaway profile and removes it.
   *
   * Checking that the file exists would only prove the file exists. What has to
   * be true is that *this account, unelevated, on this edition of Windows* can
   * make an AppContainer, and the only way to know that is to make one.
   */
  #measure(): boolean {
    if (!launcherInstalled()) return false;
    try {
      invokeLauncher(["profile-ensure", "--name", PROBE_PROFILE]);
      invokeLauncher(["profile-delete", "--name", PROBE_PROFILE]);
      return true;
    } catch {
      return false;
    }
  }

  async contain(request: ContainmentRequest): Promise<ContainedCommand> {
    const container = this.#prepare(request.policy);

    // Every ancestor of everything the child will touch has to be statable, or
    // the program dies resolving its own path before it runs a line. Most of
    // the chain is granted here, silently; what is left is system-owned and
    // needs one elevated command, named exactly.
    const traversal = ensureTraversable(
      [
        request.cwd,
        ...request.policy.readRoots,
        ...request.policy.writeRoots,
        ...(request.programRoots ?? []),
      ],
      container.sid,
    );
    for (const path of traversal.granted) container.traversed.add(path);
    // Persisted here and not at release time, because the reader is a release
    // in a *different* process, and this process is the thing that dies. A
    // contain that fails below this line still granted part of a corridor, and
    // part of a corridor is owed back all the same.
    recordTraversed(request.policy.workspaceRoot, traversal.granted);
    // Not fatal. The per-workspace entry works, and the machine-wide one is a
    // preference about accumulation, not a precondition of containment — so
    // the shortfall is reported and the run continues. It is reported on the
    // *first* containment rather than after a few hundred of them: that is the
    // whole difference between one setup command and a repair.
    this.#advisePreparation(traversal.granted);

    if (traversal.refused.length > 0) {
      // The list these entries go into is physically full. `sandbox:prepare`
      // would fail on the same directory with the same status, so the advice
      // is to shrink the list first — which is what releasing recorded
      // workspaces does, because every revoke takes a row out.
      const folders = traversal.refused.map((path) => `"${path}"`).join(" ");
      throw new SandboxError("unavailable", {
        message:
          "The permission list on " +
          folders +
          " is full, and the sandbox cannot add the entry it needs there. " +
          "Run `pnpm sandbox:release --stale` to take back what finished " +
          "workspaces were granted, then try again. If the list is still full, " +
          "the remaining entries predate the corridor record and are shown as " +
          "unresolvable S-1-15-2 rows by `icacls <directory>` — each one must be " +
          "removed by hand.",
      });
    }
    if (traversal.needsElevation.length > 0) {
      // The exact folders, and the exact command. A message that says "run
      // setup" invites running it against everything; naming what is actually
      // missing keeps the machine-wide part of this as small as the machine
      // genuinely needs — usually one or two system directories, once.
      const folders = traversal.needsElevation.map((path) => `"${path}"`).join(" ");
      throw new SandboxError("unavailable", {
        message:
          "The sandbox needs one-time setup for system folders it cannot change " +
          "on its own. In a terminal opened as administrator, run: " +
          `pnpm sandbox:prepare ${folders}`,
      });
    }
    // Read, never write: these are the program's own files, and a server that
    // rewrites its own installation is not a case worth supporting. Granted
    // after the policy's roots so a program root that *is* the workspace keeps
    // the stronger mode — `grant` is keyed by mode, so a read grant cannot
    // replace a write one.
    const programRoots = grantProgramRoots(container, request.programRoots ?? []);
    if (programRoots.length > 0) {
      // Recorded here and not at release time, for the same reason the
      // corridor is: the reader is a release in a different process, and this
      // process is the one that dies.
      recordProgramRoots(request.policy.workspaceRoot, programRoots);
    }
    return {
      executable: launcherPath(),
      args: containArgs({
        sid: container.sid,
        cwd: request.cwd,
        executable: request.executable,
        args: request.args,
        ...(request.lineJoin === undefined || request.lineJoin === "argv"
          ? {}
          : { join: request.lineJoin as LauncherJoin }),
        // Named holes in the wall, and only the one asked for. `internetClient`
        // is outbound internet and nothing else — measured, not read: loopback
        // and the LAN stay refused with it granted, and loopback stays refused
        // under every capability Windows has.
        capabilities: request.network ? ["internetClient"] : [],
      }),
    };
  }

  /**
   * The profile and the grants for one policy, created on first use.
   *
   * Lazy rather than done when the sandbox is constructed, because a workspace
   * the agent never runs a command in should not gain a permission entry. The
   * cost of a sandbox has to be paid by the feature that needs it.
   */
  #prepare(policy: SandboxPolicy): PreparedContainer {
    const key = policy.workspaceRoot;
    let container = this.#prepared.get(key);
    if (container === undefined) {
      const sid = invokeLauncher([
        "profile-ensure",
        "--name",
        profileName(key),
        "--display",
        "Project Studio sandbox",
      ]);
      if (!sid.startsWith("S-1-15-2-")) {
        // The AppContainer SID prefix. Anything else means the launcher printed
        // something other than what its contract says, and building a command
        // line out of it would be worse than stopping.
        throw new SandboxError("unavailable", {
          message: "The Windows sandbox did not return a usable identity.",
        });
      }
      container = { sid, granted: new Set(), traversed: new Set(), programRoots: new Set() };
      this.#prepared.set(key, container);
      // Written here, where the profile is actually minted, so the record
      // cannot claim something the machine does not have. The name is a hash of
      // the path and nothing can invert it, so without this a user looking at
      // `studio-9f86d081…` has no way to learn which project it belongs to.
      recordProfile(profileName(key), key);
    }

    // One grant per path, with the mode already resolved — not a read pass
    // followed by a write pass. `SetEntriesInAcl` *replaces* this trustee's
    // entry rather than adding to it, so two passes make the answer depend on
    // which ran last, and the workspace root is on both lists. Getting that
    // ordering wrong produced a sandbox that could read its own project and not
    // write to it, which is a plausible-looking sandbox and a useless agent.
    for (const [path, mode] of grantsFor(policy)) grant(container, path, mode);
    return container;
  }

  /**
   * Says which directories are accumulating one entry per workspace.
   *
   * Written to `process.stderr` directly rather than to the logger, on the
   * boot-log precedent: this must work in the maintenance command's process,
   * where nothing else is started, and it must be visible to the person rather
   * than only to the telemetry. The advice names the exact command and the
   * exact directories, as the elevation shortfall one branch below does — "run
   * setup" invites running it against everything.
   *
   * Everything passed here was *granted* to this workspace, which is exactly
   * the set that would have been skipped had the machine-wide entry existed.
   * Directories already covered by `sandbox:prepare` never reach this list, so
   * a fully prepared machine advises nothing.
   */
  #advisePreparation(granted: readonly string[]): void {
    const fresh = granted.filter((path) => !this.#advised.has(path));
    if (fresh.length === 0) return;
    for (const path of fresh) this.#advised.add(path);
    process.stderr.write(prepareAdvice(fresh));
  }

  async release(policy: SandboxPolicy): Promise<void> {
    const key = policy.workspaceRoot;
    const container = this.#prepared.get(key);
    const sid = container?.sid ?? deriveExisting(key);
    if (sid === undefined) {
      // Reported, not swallowed. An exit-zero release that revoked nothing is
      // how this defect survived its first cleanup: silence here reads as
      // "nothing was owed", when the truth is "nothing could be identified".
      // The ledger record is deliberately kept, so the workspace stays listed
      // and a later attempt — after the launcher works again — can retry.
      throw new SandboxError("unavailable", {
        message:
          "The sandbox launcher could not recover the identity of this " +
          "workspace, so nothing was revoked and its record was kept. " +
          "The launcher's own failure explains why.",
      });
    }

    // Revoked before the profile goes. Afterwards the SID no longer resolves,
    // and the entry stays in the user's folder properties as an unreadable
    // line nobody can attribute or remove without knowing what it was.
    for (const root of new Set([...policy.readRoots, ...policy.writeRoots])) {
      // A path that is gone has no entry to take back, and asking anyway used to
      // abort the whole release: the launcher reads a directory's permissions
      // before rewriting them and returns `error 2` when there is no directory.
      // Which meant `release` failed for exactly the workspaces most worth
      // releasing — the finished, deleted ones — leaving the profile behind and
      // making `--stale` fail on every entry it was built for. Found by running
      // it on a deleted project, not by reading it.
      if (!existsSync(root)) continue;
      invokeLauncher(["revoke", "--sid", sid, "--path", root]);
    }
    // The program roots go too - the directories granted read so a contained
    // interpreter could find its programs. A grant this feature adds without
    // ever taking back is a feature that grows without bound, which is the
    // exact shape the corridor's leak took: one entry per contained command,
    // for ever. A root that is one of the policy's roots is skipped, because
    // the loop above already took its entry back - revoking twice would take
    // the second entry's read down to nothing and leave the workspace
    // unreadable to its own container.
    for (const root of this.#programRootsFor(key, container)) {
      if (!existsSync(root)) continue;
      if (policy.readRoots.includes(root) || policy.writeRoots.includes(root)) continue;
      invokeLauncher(["revoke", "--sid", sid, "--path", root, "--mode", "read"]);
    }
    // The corridor goes too. Three sources, and the union is the point: the
    // in-memory set covers what this process granted, the ledger covers what
    // any process granted since the corridor was recorded, and the measured
    // sweep below covers what a process granted *before* it was recorded —
    // those entries have no field to read, and reading their absence as "no
    // corridor" is precisely the bug that let 610 entries pile up on a user's
    // home directory. The sweep asks the launcher whether this workspace's own
    // SID holds traverse on each ancestor of the policy's roots, so it can only
    // ever name entries this SID holds: nothing that belongs to anyone else is
    // ever in the answer.
    for (const ancestor of this.#corridorFor(key, policy, sid, container)) {
      if (!existsSync(ancestor)) continue;
      revokeTraverse(ancestor, sid);
    }
    invokeLauncher(["profile-delete", "--name", profileName(key)]);
    this.#prepared.delete(key);
    // Last, and only once the profile is actually gone. Forgetting first would
    // lose the one thing that can tell a user this workspace still has a
    // profile if the delete failed.
    forgetProfile(key);
  }

  /**
   * Every program directory owed a revoke, from the two places the grants are
   * known.
   *
   * The in-memory set covers what this process granted, the ledger covers
   * what any process granted since the field was recorded - including the
   * holds observed on this workspace's own SID, which are attributed to the
   * workspace for the same reason the corridor's measured sweep attributes
   * its ancestors: only this runtime ever grants these SIDs.
   */
  #programRootsFor(
    key: string,
    container: PreparedContainer | undefined,
  ): readonly string[] {
    const roots = new Set<string>(container?.programRoots ?? []);
    const recorded = readLedger().find((entry) => entry.workspaceRoot === key)?.programRoots;
    if (recorded !== undefined) for (const root of recorded) roots.add(root);
    return [...roots];
  }

  /**
   * Every ancestor owed a revoke, from the three places the corridor is known.
   *
   * The measured sweep exists for the entries written before the ledger had a
   * corridor field: their `traversed` is undefined, which means *unknown*, and
   * an unknown corridor is answered with a measurement rather than with an
   * empty set. It can only ever add ancestors this workspace's SID actually
   * holds traverse on — the same attribution rule the record itself obeys.
   */
  #corridorFor(
    key: string,
    policy: SandboxPolicy,
    sid: string,
    container: PreparedContainer | undefined,
  ): readonly string[] {
    const corridor = new Set<string>(container?.traversed ?? []);

    const recorded = readLedger().find((entry) => entry.workspaceRoot === key)?.traversed;
    if (recorded !== undefined) for (const ancestor of recorded) corridor.add(ancestor);

    const roots = new Set<string>([policy.workspaceRoot, ...policy.readRoots, ...policy.writeRoots]);
    for (const root of roots) {
      for (const ancestor of ancestorsOf(root)) {
        if (corridor.has(ancestor)) continue;
        if (holdsTraverse(ancestor, sid)) corridor.add(ancestor);
      }
    }
    return [...corridor];
  }
}

/**
 * Each root the policy names, once, with the strongest mode it is owed.
 *
 * Exported so the mapping can be asserted without a Windows machine: "a root
 * that is both readable and writable ends up writable" is a rule, not an
 * implementation detail, and it is the rule that was got wrong first.
 */
export function grantsFor(
  policy: Pick<SandboxPolicy, "readRoots" | "writeRoots">,
): ReadonlyMap<string, "read" | "write"> {
  const modes = new Map<string, "read" | "write">();
  for (const root of policy.readRoots) modes.set(root, "read");
  for (const root of policy.writeRoots) modes.set(root, "write");
  return modes;
}

/**
 * The one-time advice for directories accumulating a traverse entry each.
 *
 * Exported because its content is a rule rather than a string: it names the
 * directories, it names the exact command, and it never says the command needs
 * an administrator — the user's own directories, which is where this
 * accumulation actually happens, need no elevation. What does need elevation
 * gets the separate, conditional line from the launcher's own failure.
 */
export function prepareAdvice(paths: readonly string[]): string {
  const listed = paths.map((path) => `[sandbox]   ${path}`).join("\n");
  const command = paths.map((path) => `"${path}"`).join(" ");
  return (
    `[sandbox] These directories are taking one traverse permission entry per workspace:\n` +
    `${listed}\n` +
    `[sandbox] One setup run makes that a single machine-wide entry instead, and\n` +
    `[sandbox] nothing further accumulates there:\n` +
    `[sandbox]   pnpm sandbox:prepare ${command}\n`
  );
}

function grant(container: PreparedContainer, path: string, mode: "read" | "write"): void {
  const key = `${mode}:${path}`;
  if (container.granted.has(key)) return;
  // A path already granted at the stronger mode is left alone. `SetEntriesInAcl`
  // replaces a trustee's entry, so re-granting read over write would silently
  // take the write away — the same downgrade that made the workspace read-only
  // the first time this ran.
  if (mode === "read" && container.granted.has(`write:${path}`)) return;
  invokeLauncher(["grant", "--sid", container.sid, "--path", path, "--mode", mode]);
  container.granted.add(key);
}

/**
 * Makes every program directory a command names readable, and answers for
 * the ones it cannot.
 *
 * Three states, each its own answer:
 *
 * - **Already reachable** - this workspace holds read, or the machine-wide
 *   `ALL APPLICATION PACKAGES` entry covers it, as it does for the system
 *   directories whose programs already run. Nothing is written, and nothing
 *   is recorded: an entry we did not create is not ours to revoke.
 * - **Grantable** - added for this workspace's own SID, read-only, and
 *   recorded so a release takes it back. Bounded by how many directories a
 *   project's command lines actually name.
 * - **Not grantable** - a system-owned directory, where adding the entry
 *   needs elevation the runtime never takes. The command is refused with the
 *   sentence the model and the user need: which directories, why, and the
 *   exact command that fixes them. A shell's own `not recognized` would read
 *   as a typo and send the model to rewrite its line instead of the machine.
 *
 * Returns what this call granted or attributed, for the ledger; the refusal
 * is thrown only after every root has had its answer, so one ungrantable
 * directory does not hide the others.
 */
function grantProgramRoots(
  container: PreparedContainer,
  roots: readonly string[],
): readonly string[] {
  const attributed: string[] = [];
  const ungrantable: string[] = [];

  for (const root of roots) {
    if (container.granted.has(`read:${root}`) || container.granted.has(`write:${root}`)) {
      if (container.programRoots.has(root)) attributed.push(root);
      continue;
    }
    if (container.programRoots.has(root)) {
      attributed.push(root);
      continue;
    }

    // Either identity answers "already readable". The workspace's own entry is
    // attributable to this workspace - only this runtime grants these SIDs -
    // so a hold observed here is recorded for release even when it came from
    // a containment this process did not run, which is how the grants of a
    // ledger entry written before this field existed are found again.
    if (holdsRead(root, container.sid)) {
      container.programRoots.add(root);
      attributed.push(root);
      continue;
    }
    if (holdsRead(root, ALL_APPLICATION_PACKAGES)) continue;

    try {
      grant(container, root, "read");
    } catch (error) {
      if (isFullPermissionList(error)) {
        // The list these entries go into is physically full. Same advice, and
        // the same reason, as the traverse case: the list has to shrink before
        // anything else can be added to it.
        throw new SandboxError("unavailable", {
          message:
            "The permission list on " +
            `"${root}"` +
            " is full, and the sandbox cannot add the entry it needs there. " +
            "Run `pnpm sandbox:release --stale` to take back what finished " +
            "workspaces were granted, then try again.",
        });
      }
      ungrantable.push(root);
      continue;
    }
    container.programRoots.add(root);
    attributed.push(root);
  }

  if (ungrantable.length > 0) {
    const listed = ungrantable.map((path) => `  ${path}`).join("\n");
    const command = ungrantable.map((path) => `"${path}"`).join(" ");
    throw new SandboxError("unavailable", {
      message:
        "These directories hold programs the command needs, and the sandbox\n" +
        "cannot make them readable from here:\n" +
        listed +
        "\n" +
        "They are system-owned, and adding the read entry they need needs\n" +
        "elevation the runtime never takes. In a terminal opened as\n" +
        "administrator, run:\n" +
        `  pnpm sandbox:prepare --read ${command}\n`,
    });
  }

  return attributed;
}

/**
 * The SID of a workspace's profile when this process never prepared it.
 *
 * `release` has to work in a fresh process — the maintenance command in
 * `sandbox/cli.ts` is exactly that case — so it cannot depend on the in-memory
 * map that `contain` fills.
 */
function deriveExisting(workspaceRoot: string): string | undefined {
  try {
    const sid = invokeLauncher(["profile-ensure", "--name", profileName(workspaceRoot)]);
    return sid.startsWith("S-1-15-2-") ? sid : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The one instance.
 *
 * State — which workspaces are prepared, whether the probe has run — belongs to
 * the machine rather than to a caller, and a second instance would repeat the
 * probe and re-grant paths that are already granted.
 */
export const windowsAppContainer: IsolationBackend = new WindowsAppContainerBackend();
