import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

import { SandboxError } from "./errors.js";
import { isInsideRoot } from "./paths.js";

/**
 * Isolation levels and the effect-to-isolation mapping now live in
 * `contracts/effects.ts`, with every other rule about what an effect requires.
 * Re-exported here because this is where callers have always looked for them,
 * and moving the import site would be churn for its own sake.
 */
export {
  requiredIsolation,
  satisfiesIsolation,
  type IsolationLevel,
} from "../contracts/effects.js";

/**
 * What an agent may reach.
 *
 * The permission kernel decides *whether* a call runs. This decides *what it
 * can touch* once it does. Both are needed: an approved capability with no
 * containment is an approval to do anything, and containment without approval
 * is a boundary nobody agreed to.
 */

export interface SandboxPolicy {
  /** The agent's own directory. Relative paths resolve against it. */
  readonly workspaceRoot: string;
  /**
   * Additional readable roots, e.g. a bound project directory. The workspace
   * root is always included.
   */
  readonly readRoots: readonly string[];
  /** Roots the agent may modify. Must each be inside a readable root. */
  readonly writeRoots: readonly string[];
  /**
   * Environment variables passed through. Empty by default: inheriting
   * `process.env` hands the agent every token on the machine, and that is the
   * single most common way a local agent leaks credentials.
   */
  readonly environment: Readonly<Record<string, string>>;
  /** Whether subprocesses may be started at all. */
  readonly allowExec: boolean;
  /** Whether outbound network access is intended. */
  readonly allowNetwork: boolean;
  /**
   * Whether this project is trusted, and containment is removed for it.
   *
   * The escape hatch for the walk-up class, and for Docker. Contained is the
   * default; trusted means the project's own files are no longer the
   * boundary, stated in plain words where the person chooses it. A trusted
   * policy resolves any absolute path and runs any command uncontained.
   */
  readonly trusted: boolean;
}

export interface SandboxPolicyInput {
  readonly workspaceRoot: string;
  readonly readRoots?: readonly string[];
  readonly writeRoots?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly allowExec?: boolean;
  readonly allowNetwork?: boolean;
  readonly trusted?: boolean;
}

/**
 * The two capability switches, and the one place their defaults live.
 *
 * **Both are on.** Running commands and reaching the network are what a
 * general-purpose agent is for, and an agent that cannot do them is a text box.
 * The wall that actually protects the user is containment — `readRoots` and
 * `writeRoots`, enforced in `paths.ts` — and that one is closed by default and
 * has no override. These two are not that wall and were never doing its job.
 *
 * **Why they still exist.** Someone running this in a locked-down environment
 * needs a way to say no, and having to fork the code to get it is not a way.
 * Flipping either one here disables the capability everywhere at once — the
 * tool disappears from what the model is shown, and a direct call is refused —
 * so there is no second place to remember.
 *
 * **For anyone building a UI on top:** these are the two values to bind a
 * toggle to. Pass them to `createSandboxPolicy` per workspace, or set
 * `PROJECT_STUDIO_ALLOW_EXEC` / `PROJECT_STUDIO_ALLOW_NETWORK` to `off` for a
 * process-wide answer that needs no code change at all.
 */
const DEFAULT_CAPABILITY_SWITCHES = {
  allowExec: true,
  allowNetwork: true,
} as const;

/**
 * Reads a switch from the environment.
 *
 * Only an explicit `off`, `false`, or `0` turns something off. An unset or
 * misspelled variable leaves the default alone, because a typo in a deployment
 * script must not silently disable half the agent.
 */
function switchFromEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (raw === "off" || raw === "false" || raw === "0" || raw === "no") return false;
  if (raw === "on" || raw === "true" || raw === "1" || raw === "yes") return true;
  return fallback;
}

/**
 * The user's git configuration, as the files the contained git must read.
 *
 * Measured on Windows: when the container cannot read these, every repository
 * operation dies at exit 128 with "unknown error occurred while reading the
 * configuration files" - the program roots are already readable and the
 * ancestors already walkable, so the config is the whole gap, and granting it
 * turns `git init`, `status` and `log` from 128 to 0 with no warnings.
 *
 * File-scoped on purpose. The home as a read root would cost a propagating
 * grant over the user's whole tree on every workspace and a tree-walk revoke
 * on every release - which is exactly the accumulation `release --stale`
 * exists to undo, and the revoke alone outlasts the launcher's own timeout.
 * A file grant is one entry that `release` takes back with the policy's other
 * roots, and the files' ancestors are already corridor-covered, so nothing
 * here needs elevation. Only entries that exist are returned, because a grant
 * on a missing path fails the containment it was meant to enable.
 *
 * Windows only. Elsewhere the home is not inside the container at all, so a
 * missing config is "no such file" (a warning git tolerates) rather than
 * "permission denied" (which it does not) - and a file that may not exist
 * must not ride a bind.
 */
export function gitConfigRoots(env: NodeJS.ProcessEnv = process.env): readonly string[] {
  if (process.platform !== "win32") return [];
  const home = env.USERPROFILE ?? env.HOME ?? "";
  if (home === "") return [];
  const found: string[] = [];
  for (const candidate of [
    join(home, ".gitconfig"),
    join(home, ".config", "git", "config"),
    join(home, ".config", "git", "ignore"),
  ]) {
    try {
      if (existsSync(candidate)) found.push(candidate);
    } catch {
      // An unreadable home probed by stat is an answer, not a grant.
    }
  }
  return found;
}

/**
 * Builds a policy.
 *
 * The roots are closed by default: a policy that had to be tightened rather
 * than loosened would mean each new call site starts life able to reach the
 * whole disk, and only becomes safe if someone remembers. The capability
 * switches are the opposite, and deliberately so — see
 * `DEFAULT_CAPABILITY_SWITCHES`.
 */
export function createSandboxPolicy(input: SandboxPolicyInput): SandboxPolicy {
  const workspaceRoot = resolve(input.workspaceRoot);
  if (input.workspaceRoot.trim() === "") {
    throw new SandboxError("invalid_policy", {
      message: "A sandbox needs a workspace root.",
    });
  }

  const readRoots = [
    workspaceRoot,
    ...(input.readRoots ?? []).map((entry) => resolve(entry)),
  ];
  const writeRoots = (input.writeRoots ?? [workspaceRoot]).map((entry) =>
    resolve(entry),
  );

  // A writable root outside every readable root would let an agent modify what
  // it is not allowed to look at, which is never what anyone intends.
  //
  // Through `isInsideRoot`, not a string prefix. `/home/u/work` is a prefix of
  // `/home/u/work-secrets`, so the prefix form accepted a writable root that
  // sits outside every readable one — the exact case `paths.ts` was written to
  // solve, ten lines away.
  for (const root of writeRoots) {
    if (!readRoots.some((readable) => isInsideRoot(readable, root))) {
      throw new SandboxError("invalid_policy", {
        message: "A writable root must sit inside a readable root.",
      });
    }
  }

  return {
    workspaceRoot,
    readRoots,
    writeRoots,
    environment: { ...(input.environment ?? {}) },
    allowExec:
      input.allowExec ??
      switchFromEnv("PROJECT_STUDIO_ALLOW_EXEC", DEFAULT_CAPABILITY_SWITCHES.allowExec),
    allowNetwork:
      input.allowNetwork ??
      switchFromEnv(
        "PROJECT_STUDIO_ALLOW_NETWORK",
        DEFAULT_CAPABILITY_SWITCHES.allowNetwork,
      ),
    trusted: input.trusted ?? false,
  };
}

