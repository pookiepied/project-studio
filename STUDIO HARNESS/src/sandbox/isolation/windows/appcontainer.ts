import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

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
  invokeLauncherAsync,
  launcherInstalled,
  launcherPath,
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
  grantTraverse,
  holdsRead,
  holdsCorridor,
  isFullPermissionList,
  revokeCorridor,
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

/**
 * The path whose hash names this policy's container profile.
 *
 * The profile is per **anchor**, not per workspace, and the difference is the
 * difference between a machine that pays for a new identity once and one that
 * pays for it again with every conversation. The profile is the SID, and the
 * SID is what every scope root gets granted to — so a new identity means
 * re-placing every grant, which means Windows pushing inheritance down every
 * file the presets name. Measured on this machine: each project-less
 * conversation minted its own profile under its own workspace directory, and
 * its first contained command bought the whole walk — about a hundred seconds
 * of the harness unable to stream a byte — before the tool even ran. The
 * policy's `profileAnchor`, when present, is the stable path all of those
 * workspaces share, so the walk happens once for the anchor and never again.
 *
 * Exported because the same rule decides three things that must not drift:
 * the name minted here, the SID `release` recovers, and the ledger rows a
 * user reads.
 */
export function profileKey(
  policy: Pick<SandboxPolicy, "workspaceRoot" | "profileAnchor">,
): string {
  return policy.profileAnchor ?? policy.workspaceRoot;
}

/**
 * The folder the OS laid down for a profile, under the real LocalAppData.
 *
 * Windows hands a contained process a `LOCALAPPDATA` of `<this>\AC`, and it
 * creates the folder without an entry for the profile's own SID — measured
 * from inside the container as `EPERM … lstat …\Packages\studio-…`, raised by
 * pnpm's startup while it resolved its own environment. Every component above
 * and below the folder answers; only the folder itself does not, which is why
 * one non-inheriting traverse entry (placed at mint, taken back at release)
 * is the whole fix.
 *
 * Resolved from the environment first and the home directory second, because
 * the harness's own environment is an allowlist and `LOCALAPPDATA` is not on
 * it — `USERPROFILE` is, so `homedir()` answers in production while the
 * variable answers in a test or a maintenance command.
 */
function profileRootDirectory(key: string): string | undefined {
  let base = process.env.LOCALAPPDATA;
  if (base === undefined || base === "") {
    try {
      base = join(homedir(), "AppData", "Local");
    } catch {
      return undefined;
    }
  }
  return join(base, "Packages", profileName(key));
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
  /**
   * What has been arranged per profile key — the anchor when the policy names
   * one, the workspace root when it does not. Keying by the anchor is what
   * makes a later conversation's containment find the same container, the
   * same SID, and the same grant answers as the one that paid for them.
   */
  readonly #prepared = new Map<string, PreparedContainer>();
  /**
   * Ancestors the one-time setup advice has already been given for, so a
   * containment that runs ten thousand times advises once and not ten thousand
   * times. Per directory rather than a single flag, because a workspace on
   * another drive is a shortfall the user has not been told about yet.
   */
  readonly #advised = new Set<string>();
  /**
   * Corridors this process has already verified the machine holds, and reads
   * it has already verified `ALL APPLICATION PACKAGES` holds. Both are the
   * machine's own entries: nothing this runtime does lifts them, so a
   * measured yes stays yes for the life of the process, and each later
   * containment skips the launchers that would only repeat the question.
   * That repetition was not free: a conversation's every command re-asked the
   * corridor of every ancestor of every root — dozens of launcher processes
   * per command, all synchronous, all invisible until they were the
   * difference between a tool call that answers in a moment and one the
   * person watches. Measured on the machine this was built on, where the
   * eleven preset grants put twenty-odd roots and their ancestors behind
   * every question.
   */
  readonly #machineCorridorHolds = new Set<string>();
  readonly #machineReadHolds = new Set<string>();
  /**
   * Grants this process has already placed for a given workspace SID, keyed
   * `"mode:path"`, and the ancestors it has already proven that SID walks.
   *
   * These are the workspace-identity answers, kept beside the machine-wide
   * sets above because they share the property that makes a cached yes safe:
   * nothing this process does lifts them. The revoke path runs from the
   * maintenance command, which is its own process — the same reasoning that
   * lets `#machineCorridorHolds` keep its answers. What the cache buys is
   * measured in launcher round-trips: with a stable anchor every later
   * conversation re-enters `#prepare` with every grant already on the disk,
   * and without this set each of the eleven roots pays one launcher
   * round-trip to be told what the process already knew, per conversation,
   * on the path between the model's message and its first command.
   *
   * The window where the cache could lie is a `sandbox:release` run while a
   * conversation is live — the same window `#prepared` has always had — and
   * the maintenance command has always been the thing a person runs between
   * sessions, not during one.
   */
  readonly #sidGranted = new Map<string, Set<string>>();
  readonly #sidTraverseHeld = new Map<string, Set<string>>();
  /**
   * Containments that are mid-preparation, per workspace, so two commands
   * that race into the same cold workspace wait for one preparation instead
   * of each walking every grant alone.
   */
  readonly #preparing = new Map<string, Promise<PreparedContainer>>();

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
    const container = await this.#prepare(request.policy);

    // Every ancestor of everything the child will touch has to be statable, or
    // the program dies resolving its own path before it runs a line. Most of
    // the chain is granted here, silently; what is left is system-owned and
    // needs one elevated command, named exactly. What earlier questions in
    // this process already answered arrives too, so none of the answers are
    // bought twice — the memory lives on the process, the corridor lives on
    // the disk, and nothing revokes a machine-held corridor, so the two
    // cannot disagree while this process runs. The workspace identity's own
    // traverse answers ride along for the same reason: with a stable anchor,
    // a later conversation's corridor was placed by an earlier one, and the
    // launcher round-trip that would re-measure each ancestor is a cost every
    // command in every conversation would pay again.
    const traversal = ensureTraversable(
      [
        request.cwd,
        ...request.policy.readRoots,
        ...request.policy.writeRoots,
        ...(request.programRoots ?? []),
      ],
      container.sid,
      {
        sidHeld: this.#heldTraverseFor(container.sid, container.traversed),
        machineHeld: this.#machineCorridorHolds,
      },
    );
    for (const path of traversal.granted) {
      container.traversed.add(path);
      this.#sidTraverseHeld.get(container.sid)?.add(path);
    }
    for (const path of traversal.machineHeld) this.#machineCorridorHolds.add(path);
    // Persisted here and not at release time, because the reader is a release
    // in a *different* process, and this process is the thing that dies. A
    // contain that fails below this line still granted part of a corridor, and
    // part of a corridor is owed back all the same. Keyed by the profile
    // anchor, beside the profile itself: the ledger row is per anchor now, and
    // one row per anchor instead of one per conversation is half of what the
    // anchor buys.
    recordTraversed(profileKey(request.policy), traversal.granted);
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
    // Learned where it is spent: the AAP-read question, once per directory
    // per process, exactly like the corridor question above it.
    const programRoots = await grantProgramRoots(
      container,
      request.programRoots ?? [],
      this.#machineReadHolds,
      this.#rememberedGrants(container.sid),
    );
    if (programRoots.length > 0) {
      // Recorded here and not at release time, for the same reason the
      // corridor is: the reader is a release in a different process, and this
      // process is the one that dies.
      recordProgramRoots(profileKey(request.policy), programRoots);
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
          : { join: request.lineJoin }),
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
   *
   * Async because the grants are: with the anchors making a cold preparation
   * rare, the one that does happen is a tree walk measured in minutes, and a
   * synchronous launcher call would hold the harness's one thread still for
   * all of it — freezing the conversation's stream, the keep-alives, and
   * every other session in the process. Awaiting instead keeps the event loop
   * breathing between grants, and a grant that takes a minute takes a minute
   * without the client deciding the stream is dead. `#preparing` keeps two
   * racing commands in the same workspace from both buying the walk.
   */
  async #prepare(policy: SandboxPolicy): Promise<PreparedContainer> {
    const key = profileKey(policy);
    const existing = this.#prepared.get(key);
    if (existing !== undefined) {
      // The grants still run below — the profile was found, but the roots may
      // have grown since the last containment named them. A warm container is
      // safe to finish without the in-flight lock: every grant it names is
      // already answered by the process's own caches, so there is nothing here
      // two racing containments could both walk.
      return this.#finishPrepare(policy, existing);
    }
    const inFlight = this.#preparing.get(key);
    if (inFlight !== undefined) return inFlight;
    const prepared = this.#mintAndGrant(policy, key).finally(() => {
      this.#preparing.delete(key);
    });
    this.#preparing.set(key, prepared);
    return prepared;
  }

  /**
   * Mints the profile when needed, then places the grants, under one lock.
   *
   * The whole run is inside `#preparing`'s promise so a second command racing
   * into a cold workspace waits for the one walk instead of starting its own —
   * on a cold machine that walk is minutes, and buying it twice is the exact
   * delay the anchors exist to stop.
   */
  async #mintAndGrant(policy: SandboxPolicy, key: string): Promise<PreparedContainer> {
    let container = this.#prepared.get(key);
    if (container === undefined) {
      const sid = await invokeLauncherAsync([
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
      // The profile's own folder, made resolvable to the container standing
      // in it. Windows remaps `LOCALAPPDATA` to `<folder>\AC` for every
      // contained process, and the folder the OS created carries no entry for
      // the profile's own SID — so resolving that path dies at the folder's
      // own name while everything above and below it answers. Placed at mint,
      // so it is once per profile rather than once per command, and taken
      // back by `release` before the profile is deleted.
      const profileRoot = profileRootDirectory(key);
      if (profileRoot !== undefined && existsSync(profileRoot)) {
        try {
          grantTraverse(profileRoot, sid);
        } catch {
          // Best-effort by construction: this entry is a resolution aid, not
          // a grant any policy asked for, and a machine where it cannot be
          // placed is a machine whose containers ran without it — one tool's
          // startup is where its absence shows, not the whole sandbox. A
          // profile whose folder the OS has not created yet lands here too.
        }
      }
    }
    return this.#finishPrepare(policy, container);
  }

  /**
   * Places every grant the policy's roots are owed, on an existing container.
   *
   * Split from the profile minting so a second containment of an already
   * prepared workspace still answers for the roots it names that nobody has
   * granted yet — the routine runs every contain, the mint runs once.
   */
  async #finishPrepare(
    policy: SandboxPolicy,
    container: PreparedContainer,
  ): Promise<PreparedContainer> {
    // One grant per path, with the mode already resolved — not a read pass
    // followed by a write pass. `SetEntriesInAcl` *replaces* this trustee's
    // entry rather than adding to it, so two passes make the answer depend on
    // which ran last, and the workspace root is on both lists. Getting that
    // ordering wrong produced a sandbox that could read its own project and not
    // write to it, which is a plausible-looking sandbox and a useless agent.
    //
    // A read the machine already grants every container — the ALL APPLICATION
    // PACKAGES entry the OS itself keeps on Program Files — is skipped rather
    // than rewritten. Writing an ACE needs WRITE_DAC, which an unelevated
    // process does not hold there, so the rewrite answers error 5; and because
    // the grant never landed, this loop re-failed it on every later contain,
    // which made one preset row (the git preset's `C:\Program Files\Git`)
    // stop *every* conversation's first contained command — while the very
    // same directory, reached through the program-roots path below, worked,
    // because that path has always asked the machine before writing. The
    // policy's roots now ask the same question. Measured, not inferred: the
    // launcher answers `could not set the permissions of C:\Program Files\Git
    // (error 5)` here, and `holdsRead` answers true for the trustee the grant
    // was about to duplicate.
    //
    // A failure is collected, not thrown: the loop runs to the end, so the
    // one answer names every root that failed and the grantable ones still got
    // what they came for. The call still fails — a policy short a granted root
    // would fail the child further in, with a lesser error — but it fails
    // after the work, instead of instead of it.
    const shortfalls: GrantShortfall[] = [];
    for (const [path, mode] of grantsFor(policy)) {
      if (mode === "read") {
        // The machine's read, asked and answered: this process already asked
        // `ALL APPLICATION PACKAGES` about this very directory, and a yes
        // stays a yes, so the check does not run again. The first asks are
        // what teaches the set; the rest of the process's grants are the ones
        // that benefit.
        if (this.#machineReadHolds.has(path)) continue;
        if (holdsRead(path, ALL_APPLICATION_PACKAGES)) {
          this.#machineReadHolds.add(path);
          continue;
        }
      }
      if (this.#alreadyGranted(container, path, mode)) continue;
      try {
        await grant(container, path, mode, this.#rememberedGrants(container.sid));
      } catch (error) {
        shortfalls.push({ path, mode, error });
      }
    }
    if (shortfalls.length > 0) {
      throw new SandboxError("unavailable", { message: grantShortfall(shortfalls) });
    }
    return container;
  }

  /**
   * Whether this process has already answered this exact grant.
   *
   * Two memoised sources, asked in order. The machine's: an
   * `ALL APPLICATION PACKAGES` read this process has verified, which covers
   * the container by membership. Then the workspace identity's own: with a
   * stable anchor, the disk already holds every grant a later conversation
   * asks for, and the launcher round-trip that would re-measure each one is
   * the difference between a first command that answers in a moment and one
   * the person watches. Both sets are cached under the reasoning recorded on
   * the fields themselves — nothing in this process revokes what they
   * describe.
   */
  #alreadyGranted(container: PreparedContainer, path: string, mode: "read" | "write"): boolean {
    if (this.#sidGranted.get(container.sid)?.has(`${mode}:${path}`) === true) return true;
    if (mode === "read" && this.#sidGranted.get(container.sid)?.has(`write:${path}`) === true) {
      return true;
    }
    return false;
  }

  /**
   * The traverse answers already held for one SID, the in-memory and cached
   * sets merged, with the cache created on first ask.
   */
  #heldTraverseFor(sid: string, containerHeld: ReadonlySet<string>): ReadonlySet<string> {
    let held = this.#sidTraverseHeld.get(sid);
    if (held === undefined) {
      held = new Set<string>();
      this.#sidTraverseHeld.set(sid, held);
    }
    for (const path of containerHeld) held.add(path);
    return held;
  }

  /** The grant answers held for one SID, created on first ask so it is written into. */
  #rememberedGrants(sid: string): Set<string> {
    let granted = this.#sidGranted.get(sid);
    if (granted === undefined) {
      granted = new Set<string>();
      this.#sidGranted.set(sid, granted);
    }
    return granted;
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
    // The anchor, not the workspace root: the profile and its ledger row are
    // per anchor, and a release that looked the workspace up by its own root
    // would recover no SID and revoke nothing — exactly the silent non-release
    // this method already had one defect named after.
    const key = profileKey(policy);
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
      // A root the workspace's identity holds nothing on has none of ours to
      // take back, and asking anyway is the same unelevated WRITE_DAC the
      // grant skipped: the machine-covered roots (the ALL APPLICATION PACKAGES
      // read on Program Files, pointed at by the git preset) never got a
      // per-workspace ACE, so the revoke loop must not try to lift one, or the
      // release dies on exactly the grant the contain survived without. Where
      // the SID does hold something, this is the question the launcher itself
      // answers by rewriting the descriptor — asked read-only, first.
      if (!holdsRead(root, sid)) continue;
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
      revokeCorridor(ancestor, sid);
    }
    // The profile's own folder carries the traverse entry minting placed, and
    // it goes before the profile does — afterwards the SID no longer resolves
    // and the entry is an unreadable line in the user's folder properties,
    // the same reason every workspace entry above goes first. A profile that
    // predates this entry, or one whose folder is already gone, lands in the
    // `existsSync`/no-op path rather than failing the release.
    const profileRoot = profileRootDirectory(key);
    if (profileRoot !== undefined && existsSync(profileRoot)) {
      try {
        revokeTraverse(profileRoot, sid);
      } catch {
        // Release is the cleanup path, and one entry it cannot lift must not
        // leave the profile behind: the delete below still runs.
      }
    }
    invokeLauncher(["profile-delete", "--name", profileName(key)]);
    this.#prepared.delete(key);
    // Last, and only once the profile is actually gone. Forgetting first would
    // lose the one thing that can tell a user this workspace still has a
    // profile if the delete failed.
    forgetProfile(key);
    // And the process's own answers for this SID die with the grants they
    // describe. This is the one act this runtime performs that lifts what the
    // caches described, so the caches stop describing it: a containment after
    // this release must ask the launcher again, or it would skip grants that
    // were just taken back and hand the child a workspace it cannot read. The
    // cache holds answers for one identity, and other policies may share that
    // identity through an anchor, so the whole set is dropped rather than
    // pruned — a later containment re-asks and the launcher answers
    // `already applied` in milliseconds for whatever survived.
    this.#sidGranted.delete(sid);
    this.#sidTraverseHeld.delete(sid);
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
        if (holdsCorridor(ancestor, sid)) corridor.add(ancestor);
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

/** One policy root the grant loop could not place, with the launcher's answer. */
export interface GrantShortfall {
  readonly path: string;
  readonly mode: "read" | "write";
  readonly error: unknown;
}

/**
 * The one answer for every grant the policy's roots could not get.
 *
 * Exported because its content is a rule rather than a string, on the
 * `prepareAdvice` precedent: it names every path, it repeats what the launcher
 * actually answered, and it ends in the one command that fixes the reads. A
 * policy short a grant fails the call — that part is not negotiable, the
 * child would meet the same denial further in wearing a lesser error — but a
 * failure collected in the loop rather than thrown from it lets this message
 * carry the whole list at once, which is the difference between "here is
 * everything that went without" and "access denied".
 */
export function grantShortfall(shortfalls: readonly GrantShortfall[]): string {
  const listed = shortfalls
    .map(
      (entry) =>
        `  (${entry.mode})  ${entry.path}\n` +
        `        ${shortfallReason(entry.error)}`,
    )
    .join("\n");
  const reads = shortfalls.filter((entry) => entry.mode === "read");
  const writes = shortfalls.filter((entry) => entry.mode === "write");

  let message =
    "The sandbox could not finish this workspace's grants. Each one, and what\n" +
    "the launcher answered for it:\n" +
    listed +
    "\n";

  if (reads.length > 0) {
    const folders = reads.map((entry) => `"${entry.path}"`).join(" ");
    message +=
      "\nA read like these is granted to every container at once, once, by the\n" +
      "machine's setup step; the next conversation then skips the grant, because\n" +
      "the machine already holds it. In a terminal opened as administrator, run:\n" +
      `  pnpm sandbox:prepare --read ${folders}\n`;
  }
  if (writes.length > 0) {
    message +=
      "\nA write grant needs the directory to belong to the account, or the\n" +
      "entry placed by an elevated hand. No preset ships one outside the\n" +
      "account's own folders; a custom one that does meets this same limit.\n";
  }
  return message;
}

function shortfallReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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

/**
 * Places one grant, and records it in the process's answer set.
 *
 * Async because a read or write grant makes Windows walk the tree beneath the
 * path — the walk that was measured at eighty seconds cold — and the caller
 * has work to do while it runs. The `remembered` set is the process's own
 * answer cache: a grant this process placed is a question this process never
 * needs to ask the launcher again, for any later workspace standing on the
 * same identity. The stronger-mode rule is unchanged: a read grant is
 * silently skipped when write is already held, because `SetEntriesInAcl`
 * replaces a trustee's entry rather than adding to it, and re-granting read
 * over write would take the write away.
 */
async function grant(
  container: PreparedContainer,
  path: string,
  mode: "read" | "write",
  remembered?: Set<string>,
): Promise<void> {
  const key = `${mode}:${path}`;
  if (container.granted.has(key)) return;
  // A path already granted at the stronger mode is left alone. `SetEntriesInAcl`
  // replaces a trustee's entry, so re-granting read over write would silently
  // take the write away — the same downgrade that made the workspace read-only
  // the first time this ran.
  if (mode === "read" && container.granted.has(`write:${path}`)) return;
  if (remembered?.has(key) === true) return;
  await invokeLauncherAsync(["grant", "--sid", container.sid, "--path", path, "--mode", mode]);
  container.granted.add(key);
  remembered?.add(key);
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
  /**
   * The reads this process has already verified the machine holds, learned
   * here and answered from there. This function grants nothing it need not,
   * so a yes it learned is the caller's to keep — the caller passes its own
   * process-lifetime sets and this adds to them, the same citizenship the
   * corridor's `machineHeld` answers carry. The caller also passes the
   * process's own grant answers for this SID, so a program root one
   * conversation already made readable is one no later containment in this
   * process pays a launcher round-trip to re-ask.
   */
  machineHeldReads: Set<string>,
  remembered?: Set<string>,
): Promise<readonly string[]> {
  return programRootsGrants(container, roots, machineHeldReads, remembered);
}

/**
 * The body of the program-roots walk.
 *
 * Standalone rather than a method so the memoised sets it consults arrive as
 * arguments — the same inputs the class keeps, handed in by the one caller
 * that owns them.
 */
async function programRootsGrants(
  container: PreparedContainer,
  roots: readonly string[],
  machineHeldReads: Set<string>,
  remembered?: Set<string>,
): Promise<readonly string[]> {
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
    if (
      container.granted.has(`read:${root}`) ||
      container.granted.has(`write:${root}`) ||
      (remembered?.has(`read:${root}`) === true || remembered?.has(`write:${root}`) === true)
    ) {
      container.programRoots.add(root);
      attributed.push(root);
      continue;
    }
    if (holdsRead(root, container.sid)) {
      container.programRoots.add(root);
      remembered?.add(`read:${root}`);
      attributed.push(root);
      continue;
    }
    if (machineHeldReads.has(root)) continue;
    if (holdsRead(root, ALL_APPLICATION_PACKAGES)) {
      machineHeldReads.add(root);
      continue;
    }

    try {
      await grant(container, root, "read", remembered);
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
 * The SID of a profile when this process never prepared it.
 *
 * `release` has to work in a fresh process — the maintenance command in
 * `sandbox/cli.ts` is exactly that case — so it cannot depend on the in-memory
 * map that `contain` fills. Takes the profile key, the same path whose hash
 * names the profile the ledger recorded.
 */
function deriveExisting(key: string): string | undefined {
  try {
    const sid = invokeLauncher(["profile-ensure", "--name", profileName(key)]);
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
