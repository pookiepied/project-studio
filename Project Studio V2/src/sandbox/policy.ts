import { resolve } from "node:path";

import type { CapabilityEffect } from "../contracts/capabilities.js";
import { SandboxError } from "./errors.js";

/**
 * What an agent may reach.
 *
 * The permission kernel decides *whether* a call runs. This decides *what it
 * can touch* once it does. Both are needed: an approved capability with no
 * containment is an approval to do anything, and containment without approval
 * is a boundary nobody agreed to.
 */

/**
 * How strongly a sandbox isolates.
 *
 * This is a capability claim the provider makes about itself, and it is what
 * lets the harness refuse work that needs isolation it does not have — rather
 * than running it anyway and calling the result sandboxed.
 */
export type IsolationLevel =
  /**
   * In-process enforcement only: paths are checked, ambient environment is
   * withheld. Effective against an agent that goes off-track. Not a boundary
   * against code that is actively hostile, because anything that reaches a
   * real subprocess is outside our checks.
   */
  | "in-process"
  /** OS-level isolation: separate kernel or supervised namespace. */
  | "os"
  /** Hardware isolation on another machine. */
  | "remote-vm";

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

/**
 * The isolation an effect requires.
 *
 * Running code and reaching the network cannot be contained from inside our
 * own process: once a subprocess exists, our path checks are irrelevant to it,
 * and nothing in userspace Node can stop it opening a socket. Saying so
 * explicitly is what keeps "sandboxed" from becoming a word we use loosely.
 */
export function requiredIsolation(effect: CapabilityEffect): IsolationLevel {
  return effect === "execute" || effect === "network" ? "os" : "in-process";
}

const ISOLATION_RANK: Record<IsolationLevel, number> = {
  "in-process": 0,
  os: 1,
  "remote-vm": 2,
};

export function satisfiesIsolation(
  provided: IsolationLevel,
  required: IsolationLevel,
): boolean {
  return ISOLATION_RANK[provided] >= ISOLATION_RANK[required];
}
