import { createHash } from "node:crypto";

import { SandboxError } from "../../errors.js";
import type { SandboxPolicy } from "../../policy.js";
import type {
  ContainedCommand,
  ContainmentRequest,
  IsolationBackend,
} from "../backend.js";
import { containArgs, invokeLauncher, launcherInstalled, launcherPath } from "./launcher.js";
import { ensureTraversable, revokeTraverse } from "./traversal.js";

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
    for (const root of request.programRoots ?? []) grant(container, root, "read");
    return {
      executable: launcherPath(),
      args: containArgs({
        sid: container.sid,
        cwd: request.cwd,
        executable: request.executable,
        args: request.args,
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
      container = { sid, granted: new Set(), traversed: new Set() };
      this.#prepared.set(key, container);
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

  async release(policy: SandboxPolicy): Promise<void> {
    const key = policy.workspaceRoot;
    const container = this.#prepared.get(key);
    const sid = container?.sid ?? deriveExisting(key);
    if (sid === undefined) return;

    // Revoked before the profile goes. Afterwards the SID no longer resolves,
    // and the entry stays in the user's folder properties as an unreadable
    // line nobody can attribute or remove without knowing what it was.
    for (const root of new Set([...policy.readRoots, ...policy.writeRoots])) {
      invokeLauncher(["revoke", "--sid", sid, "--path", root]);
    }
    // The corridor goes too. These are entries on directories the user owns —
    // their home folder among them — and leaving them behind would be the
    // "only ever adds" growth this method exists to prevent.
    for (const ancestor of container?.traversed ?? []) revokeTraverse(ancestor, sid);
    invokeLauncher(["profile-delete", "--name", profileName(key)]);
    this.#prepared.delete(key);
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
