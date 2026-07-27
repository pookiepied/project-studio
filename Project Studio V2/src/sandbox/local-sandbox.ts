import { readdir, readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CapabilityEffect } from "../contracts/capabilities.js";
import { SandboxError } from "./errors.js";
import { resolveContainedPath } from "./paths.js";
import {
  requiredIsolation,
  satisfiesIsolation,
  type IsolationLevel,
  type SandboxPolicy,
} from "./policy.js";

/**
 * Containment on the user's own machine.
 *
 * Every filesystem operation resolves through `resolveContainedPath`, so there
 * is one place where "is this allowed" is decided and no second path around it.
 *
 * Its honest limit, stated here because a sandbox that oversells itself is
 * worse than none: this is `in-process` isolation. It constrains what *our*
 * code does on the agent's behalf. It is effective against an agent that goes
 * off-track — the realistic failure — and it is not a boundary against code
 * that is actively hostile, because a real subprocess is outside our checks
 * entirely. That is why `execute` and `network` are refused here rather than
 * approximated, and belong to an OS-isolated or remote sandbox.
 */
export class LocalSandbox {
  readonly isolation: IsolationLevel = "in-process";
  readonly #policy: SandboxPolicy;

  constructor(policy: SandboxPolicy) {
    this.#policy = policy;
  }

  get policy(): SandboxPolicy {
    return this.#policy;
  }

  /**
   * Refuses an effect this sandbox cannot actually contain.
   *
   * Checked before the work starts, so the caller can route to a stronger
   * sandbox instead of discovering the gap after something has already run.
   */
  assertSupports(effect: CapabilityEffect): void {
    if (effect === "execute" && !this.#policy.allowExec) {
      throw new SandboxError("not_permitted", {
        message: "This agent is not allowed to run commands.",
      });
    }
    if (effect === "network" && !this.#policy.allowNetwork) {
      throw new SandboxError("not_permitted", {
        message: "This agent is not allowed to reach the network.",
      });
    }

    if (!satisfiesIsolation(this.isolation, requiredIsolation(effect))) {
      throw new SandboxError("unsupported_isolation");
    }
  }

  /** Resolves a path the agent may read, or refuses. */
  resolveRead(path: string): string {
    return resolveContainedPath(
      this.#policy.workspaceRoot,
      path,
      this.#policy.readRoots,
    );
  }

  /** Resolves a path the agent may modify, or refuses. */
  resolveWrite(path: string): string {
    return resolveContainedPath(
      this.#policy.workspaceRoot,
      path,
      this.#policy.writeRoots,
    );
  }

  /**
   * The environment a subprocess would receive.
   *
   * Built from the policy alone and never from `process.env`. An agent that
   * inherits the host environment inherits every API token on the machine,
   * which would undo the entire credential design in one line.
   */
  environment(): Record<string, string> {
    return { ...this.#policy.environment };
  }

  async readFile(path: string): Promise<string> {
    return readFile(this.resolveRead(path), "utf8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    const target = this.resolveWrite(path);

    // Parents are created automatically, matching Flue's filesystem contract in
    // every sandbox mode. The parent of a contained path is contained, so this
    // cannot reach outside; it is checked again anyway rather than reasoned
    // about at the call site.
    await mkdir(this.resolveWrite(dirname(target)), { recursive: true });
    await writeFile(target, content, "utf8");
  }

  async readdir(path: string): Promise<string[]> {
    return readdir(this.resolveRead(path));
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.resolveRead(path));
      return true;
    } catch (error) {
      // A path outside the sandbox is refused, not reported as absent:
      // answering "no" would let an agent probe the filesystem by asking.
      if (error instanceof SandboxError) throw error;
      return false;
    }
  }

  async mkdir(path: string): Promise<void> {
    await mkdir(this.resolveWrite(path), { recursive: true });
  }

  async remove(path: string): Promise<void> {
    const target = this.resolveWrite(path);

    // Deleting the workspace root itself is never a legitimate operation and
    // would take the agent's own working directory with it.
    if (target === this.#policy.workspaceRoot) {
      throw new SandboxError("not_permitted", {
        message: "The workspace root cannot be removed.",
      });
    }

    await rm(target, { recursive: true, force: true });
  }
}
