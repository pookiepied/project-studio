import { execFileSync } from "node:child_process";

import { resolveBinary } from "../../../vendor/resolver.js";
import type { SandboxPolicy } from "../../policy.js";
import type {
  ContainedCommand,
  ContainmentRequest,
  IsolationBackend,
} from "../backend.js";
import { programRoots } from "../program-roots.js";

/**
 * OS containment on Linux, using `bwrap`.
 *
 * ## Why the OS's binary and not one of ours
 *
 * Windows needed a launcher written because Node cannot make the Win32 calls
 * containment requires. Linux needs no such thing: `bwrap` **is** that launcher,
 * supplied by the distribution, reviewed by it, and updated on its schedule.
 * Shipping our own would mean vendoring a setuid-adjacent security tool and
 * owning its CVEs, which is a worse trade than depending on one the user's
 * package manager already maintains.
 *
 * So this backend builds an argument vector and nothing else. There is no
 * profile to create, no identity to derive, and — the part worth stating —
 * **nothing is written to the user's disk**. The Windows backend adds an
 * access-control entry to the project directory and has a `release()` that takes
 * it back; here containment is a property of the process and evaporates with it.
 * `release()` is a genuine no-op rather than an unimplemented one.
 *
 * ## The two orderings that carry the meaning
 *
 * `bwrap` applies mounts in argument order and a later one wins. That turns two
 * rules into positions in a list rather than into logic:
 *
 * - **System paths first, the policy's roots after.** A workspace that happens
 *   to live under a system path is still the workspace.
 * - **Read roots before write roots.** A root on both lists ends up writable.
 *   This is the same rule the Windows backend spells out in `grantsFor`, where
 *   it had to be a map because `SetEntriesInAcl` *replaces* an entry — getting
 *   it wrong there produced a sandbox that could read its own project and not
 *   write to it. Same rule, two mechanisms, and both are pinned by a test.
 *
 * ## What the child has to be able to reach to start at all
 *
 * Windows opens the executable's image with the *launcher's* rights before the
 * container token applies, so the program runs without its directory being
 * granted. `bwrap` has no such trick: it `exec`s **inside** the namespace, so an
 * executable that is not bound in simply is not there. `/usr` covers a
 * distribution's own `node`; it does not cover `nvm`, `fnm`, a toolchain in the
 * user's home, or anything else people actually run — so the executable's own
 * root is bound read-only, through the same `programRoots` the MCP launcher
 * uses for script arguments.
 */

/**
 * The world every contained child gets, before the policy says anything.
 *
 * `--unshare-all` is every namespace including the network; sharing the network
 * back is the *only* thing {@link ContainmentRequest.network} does. `--proc` and
 * `--dev` are new instances rather than the host's, so the child sees its own
 * process table and a minimal device set. `--tmpfs /tmp` gives it a private
 * scratch directory instead of the host's, which is both safer and closer to
 * what a program expects `/tmp` to be.
 *
 * `--die-with-parent` is not tidiness. Without it a child that outlives the
 * harness keeps its namespaces and its bind mounts, and the thing containment is
 * for — that the child cannot outlast our control of it — stops being true.
 *
 * `--new-session` detaches the controlling terminal. A process that keeps one
 * can push characters back into it with `TIOCSTI`, which is a contained program
 * typing commands at the user's shell.
 */
const BASE_ARGUMENTS: readonly string[] = [
  "--unshare-all",
  "--die-with-parent",
  "--new-session",
  "--proc",
  "/proc",
  "--dev",
  "/dev",
  "--tmpfs",
  "/tmp",
];

/**
 * The system directories a dynamically linked program needs to start.
 *
 * `--ro-bind-try` rather than `--ro-bind` for everything except `/usr`: on a
 * merged-`/usr` distribution `/bin`, `/lib` and `/sbin` are symlinks and on some
 * `/lib64` does not exist at all, and a hard bind on a path that is not there
 * fails the whole launch. `/usr` is the one that is never optional, so it is the
 * one allowed to fail loudly.
 */
const SYSTEM_ROOTS: readonly string[] = ["/bin", "/lib", "/lib32", "/lib64", "/sbin"];

/**
 * What a program needs to resolve a name and check a certificate.
 *
 * Bound only when the network is allowed, and named individually rather than
 * binding `/etc` wholesale — the child's business is its own API call, not the
 * machine's user list, mail configuration or cron table.
 */
const NETWORK_CONFIGURATION: readonly string[] = [
  "/etc/resolv.conf",
  "/etc/hosts",
  "/etc/nsswitch.conf",
  "/etc/ssl",
  "/etc/pki",
  "/etc/ca-certificates",
  "/etc/ca-certificates.conf",
];

/** Everything `bwrapArgs` needs, with no policy vocabulary left in it. */
export interface BwrapInput {
  readonly cwd: string;
  readonly executable: string;
  readonly args: readonly string[];
  /** Bound read-only. */
  readonly readRoots: readonly string[];
  /** Bound read-write, and applied after the read roots so it wins. */
  readonly writeRoots: readonly string[];
  /** The program's own files. Read-only, and applied before the policy's. */
  readonly programRoots: readonly string[];
  readonly network: boolean;
}

/**
 * The argument vector, as a pure function.
 *
 * Separated from everything that touches the machine so the construction can be
 * asserted on any platform — the same reason `containArgs` is a pure function on
 * the Windows side. What a command line *says* is testable everywhere; what the
 * kernel does with it is not, and that lives in the integration suite.
 */
export function bwrapArgs(input: BwrapInput): readonly string[] {
  const args: string[] = [...BASE_ARGUMENTS];

  if (input.network) args.push("--share-net");

  args.push("--ro-bind", "/usr", "/usr");
  for (const root of SYSTEM_ROOTS) args.push("--ro-bind-try", root, root);
  if (input.network) {
    for (const path of NETWORK_CONFIGURATION) args.push("--ro-bind-try", path, path);
  }

  // Program files, then read roots, then write roots. Order is the rule: a path
  // named twice takes the mode of its last mention.
  for (const root of input.programRoots) args.push("--ro-bind-try", root, root);
  for (const root of input.readRoots) args.push("--ro-bind", root, root);
  for (const root of input.writeRoots) args.push("--bind", root, root);

  args.push("--chdir", input.cwd);
  // Everything after `--` is the child. Without it a program whose own first
  // argument begins with a dash would be read as more options for `bwrap`.
  args.push("--", input.executable, ...input.args);
  return args;
}

/** Where `bwrap` is, or a refusal that names what to install. */
export function bwrapPath(): string {
  return resolveBinary("bwrap").path;
}

/** What a containment probe found. */
export interface ProbeResult {
  readonly ok: boolean;
  /** What the kernel said, when it said no. Never a guess. */
  readonly detail?: string;
}

/** Whose ability to contain is being measured. */
export interface ProbeIdentity {
  readonly uid: number;
  readonly gid: number;
}

/**
 * The unprivileged account whose answer the setup command actually needs.
 *
 * `nobody` on every distribution that ships one, and the point is that the
 * *number* barely matters: the AppArmor restriction is attached to the program,
 * not to the person, so any account without `CAP_SYS_ADMIN` returns the same
 * verdict. This is the stand-in for "somebody who is not root" when there is no
 * real candidate to name.
 */
const NOBODY: ProbeIdentity = { uid: 65_534, gid: 65_534 };

/**
 * Who a *setup* command must ask about, which is rarely the process asking.
 *
 * Root creates user namespaces whatever the kernel's restriction says — it holds
 * `CAP_SYS_ADMIN`, and AppArmor's `userns` rule never applies to it. So `sudo
 * pnpm sandbox:prepare` probing itself measures the one account on the machine
 * whose answer does not matter, concludes the sandbox already works, and exits
 * without installing anything. Measured on Ubuntu 24.04: the same `bwrap`
 * command fails for the user and succeeds under `sudo`.
 *
 * That is not a rough edge, it is the failure this seam exists to prevent,
 * wearing the setup command as a disguise: containment reported as working while
 * every contained thing the user runs is refused.
 *
 * Pure in its arguments so the mapping can be asserted on any platform — the
 * caller supplies `process.getuid?.()` and `process.env`. `undefined` means
 * "measure yourself", which is right whenever the asker is already unprivileged.
 */
export function unprivilegedIdentity(
  uid: number | undefined,
  env: NodeJS.ProcessEnv,
): ProbeIdentity | undefined {
  if (uid !== 0) return undefined;

  // `sudo` names the person who invoked it, and they are exactly who will run
  // Studio afterwards. Preferred over `nobody` because a machine could in
  // principle confine that one account further, and the answer they get should
  // be the answer about them.
  const sudoUid = Number(env["SUDO_UID"]);
  const sudoGid = Number(env["SUDO_GID"]);
  if (Number.isInteger(sudoUid) && sudoUid > 0) {
    return {
      uid: sudoUid,
      gid: Number.isInteger(sudoGid) && sudoGid > 0 ? sudoGid : sudoUid,
    };
  }
  return NOBODY;
}

/**
 * Actually contains something trivial, and reports what happened.
 *
 * A free function rather than only a method, because the setup command needs to
 * ask **again** after installing an AppArmor profile — and the backend memoises
 * its answer, correctly, since the probe starts a process. A second question
 * needs a second measurement, not a stale one.
 *
 * `as` runs the probe under another account. Dropping to a non-zero uid drops
 * the capabilities with it, which is the whole reason this works: the child is
 * unprivileged in the way that makes the kernel's restriction apply.
 */
export function probeContainment(path: string, as?: ProbeIdentity): ProbeResult {
  try {
    execFileSync(
      path,
      [
        "--unshare-all",
        "--ro-bind",
        "/usr",
        "/usr",
        ...SYSTEM_ROOTS.flatMap((root) => ["--ro-bind-try", root, root]),
        "--",
        "/bin/true",
      ],
      {
        timeout: 10_000,
        stdio: ["ignore", "ignore", "pipe"],
        // Set together or not at all: `gid` after `uid` cannot be changed back,
        // so Node applies them in that order and a missing `gid` would leave the
        // child in root's group.
        ...(as === undefined ? {} : { uid: as.uid, gid: as.gid }),
      },
    );
    return { ok: true };
  } catch (cause) {
    return { ok: false, detail: failureText(cause) };
  }
}

/**
 * What the failed probe actually said, in one line.
 *
 * `bwrap` explains itself on stderr — "setting up uid map: Permission denied"
 * is the Ubuntu 24.04 refusal, and it is a far better diagnostic than the exit
 * code. Falls back to the error's own message when there is no stderr, which is
 * the case when the binary could not be executed at all.
 */
function failureText(cause: unknown): string {
  const stderr = (cause as { stderr?: Buffer | string } | null)?.stderr;
  const text = stderr === undefined ? "" : String(stderr).trim();
  if (text !== "") return text.split("\n")[0] ?? text;
  return cause instanceof Error ? cause.message : String(cause);
}

class LinuxBwrapBackend implements IsolationBackend {
  readonly name = "bwrap";
  readonly level = "os" as const;

  /** Memoised: the probe starts a real process. */
  #availability: boolean | undefined;
  /** What the probe saw when it failed. Never a guess — see {@link diagnose}. */
  #observed: string | undefined;

  available(): boolean {
    this.#availability ??= this.#measure();
    return this.#availability;
  }

  /**
   * Why this host refused, quoting the refusal.
   *
   * The remedy sentence is fixed and the cause is not: what the kernel said is
   * reported verbatim, and the advice that follows is the set of things known
   * to produce that class of failure. Writing it the other way round — deciding
   * the cause and printing only the fix — is how a Windows `ETIMEDOUT` got
   * reported as "run as administrator" to someone already elevated, and sent
   * the investigation at the wrong wall for an afternoon.
   */
  diagnose(): string | undefined {
    if (this.#availability !== false) return undefined;
    if (this.#observed === undefined) return undefined;
    return (
      `The sandbox program could not start a container here: ${this.#observed} ` +
      "Most often this is a kernel that withholds user namespaces from " +
      "unprivileged programs, which `sudo pnpm sandbox:prepare` fixes for this " +
      "machine by granting the namespace to bubblewrap alone."
    );
  }

  /**
   * Actually contains something trivial, and looks at the exit code.
   *
   * Checking that `bwrap` is on `PATH` would prove only that a file is on
   * `PATH`. The question is whether *this kernel, for this unprivileged user*
   * will hand out a user namespace, and there are common machines where the
   * answer is no while the binary is installed and looks fine:
   *
   * - **Ubuntu 23.10 and later** ship `kernel.apparmor_restrict_unprivileged_userns=1`,
   *   which refuses the namespace to any program without an AppArmor profile
   *   granting `userns create`. Measured on Ubuntu 24.04, where `bwrap` 0.9.0 is
   *   installed and fails with `setting up uid map: Permission denied`.
   * - **Debian and RHEL derivatives** have historically shipped
   *   `kernel.unprivileged_userns_clone=0`.
   * - **Containers and CI** frequently deny the syscall by seccomp.
   *
   * On every one of those, a platform-name check would claim containment this
   * host cannot deliver, and `execute` would run uncontained under a build that
   * says it is contained. That is the failure this whole seam exists to prevent,
   * so the probe pays for a process.
   *
   * The first of those has a supported fix — `pnpm sandbox:prepare`, which
   * installs an AppArmor profile granting the namespace to `bwrap` alone. See
   * `apparmor.ts` for why that rather than the sysctl everyone reaches for.
   */
  #measure(): boolean {
    let path: string;
    try {
      path = bwrapPath();
    } catch (cause) {
      // Not installed. The resolver's message already names the package and the
      // command for the common distributions, so it is passed through rather
      // than rewritten.
      this.#observed = cause instanceof Error ? cause.message : String(cause);
      return false;
    }

    const probe = probeContainment(path);
    if (!probe.ok) this.#observed = probe.detail;
    return probe.ok;
  }

  async contain(request: ContainmentRequest): Promise<ContainedCommand> {
    // The executable's own root, which Windows gets for free and this does not:
    // `bwrap` execs inside the namespace, so a `node` under `~/.nvm` is simply
    // absent unless it is bound in.
    const roots = new Set([
      ...programRoots([request.executable]),
      ...(request.programRoots ?? []),
    ]);

    return {
      executable: bwrapPath(),
      args: bwrapArgs({
        cwd: request.cwd,
        executable: request.executable,
        args: request.args,
        readRoots: request.policy.readRoots,
        writeRoots: request.policy.writeRoots,
        programRoots: [...roots],
        network: request.network,
      }),
    };
  }

  /**
   * Nothing to undo.
   *
   * Stated rather than left empty. The interface has `release` because the
   * Windows backend writes into the user's project directory and a feature that
   * only ever adds is a feature that grows; a namespace has no such cost, and
   * saying so is more useful than a `TODO` that implies something is missing.
   */
  async release(_policy: SandboxPolicy): Promise<void> {}
}

/** The one instance, for the same reason the Windows one is a singleton. */
export const linuxBwrap: IsolationBackend = new LinuxBwrapBackend();
