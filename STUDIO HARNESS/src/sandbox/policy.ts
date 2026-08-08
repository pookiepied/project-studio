import { resolve } from "node:path";

import { SandboxError } from "./errors.js";

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
}

export interface SandboxPolicyInput {
  readonly workspaceRoot: string;
  readonly readRoots?: readonly string[];
  readonly writeRoots?: readonly string[];
  readonly environment?: Readonly<Record<string, string>>;
  readonly allowExec?: boolean;
  readonly allowNetwork?: boolean;
}

/**
 * Builds a policy that is closed by default.
 *
 * Every field defaults to the most restrictive value. A policy that had to be
 * tightened rather than loosened would mean each new call site starts life
 * over-permissioned and only becomes safe if someone remembers.
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
  for (const root of writeRoots) {
    if (!readRoots.some((readable) => root === readable || root.startsWith(readable))) {
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
    allowExec: input.allowExec ?? false,
    allowNetwork: input.allowNetwork ?? false,
  };
}

