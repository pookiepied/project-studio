import { readdir, readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CapabilityDescriptor } from "../contracts/capabilities.js";
import { SandboxError } from "./errors.js";
import { resolveContainedPath } from "./paths.js";
import {
  requiredIsolation,
  satisfiesIsolation,
  type IsolationLevel,
  type SandboxPolicy,
} from "./policy.js";

export interface SandboxFileStat {
  readonly isFile: boolean;
  readonly isDirectory: boolean;
  readonly size: number;
  /** Milliseconds since the epoch, for change detection. */
  readonly modifiedAt: number;
}

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
 * entirely.
 *
 * It never claims otherwise. Where it admits `execute`, it admits it as
 * *uncontained by consent* rather than as containment — see `assertSupports`.
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
   * Refuses a capability this sandbox cannot honestly admit.
   *
   * Takes the descriptor rather than a bare effect, because the answer depends
   * on **who chose the code**, not only on what it does. Containing hostile
   * code needs OS isolation, and that has not changed. Running a program the
   * user chose, in a folder the user trusted, with their approval is not
   * containment — it is doing as asked, and the requirement there is
   * authorization.
   *
   * So the line is provenance, and it is absolute in one direction:
   *
   * - **Native, and the policy opted in** — allowed, and honestly *uncontained*.
   *   Permission, trust, and the mode are what bound it.
   * - **Anything a user connected** — refused until a real isolation tier
   *   exists. We do not run a program a third party chose without a boundary,
   *   whatever the permissions say.
   *
   * ADR 0012 refused `execute` outright, and was right at the time: there was
   * no workspace trust and no execution modes, so authorization was too weak to
   * carry the weight. ADR 0018 changed that. See ADR 0019.
   */
  /**
   * The same question as `assertSupports`, asked without the exception.
   *
   * It exists so the list the model is shown can be built from the rule that
   * decides the call. Those used to be two questions with two answers: a tool
   * appeared in the prompt, was called, and was refused — one wasted attempt,
   * and a schema billed on every turn for something that could never run.
   *
   * One rule asked twice, rather than the check written out again here. Two
   * copies of a meaning is what `T-28` was.
   */
  supports(capability: CapabilityDescriptor): boolean {
    try {
      this.assertSupports(capability);
      return true;
    } catch {
      return false;
    }
  }

  assertSupports(capability: CapabilityDescriptor): void {
    for (const effect of capability.effects) {
      if (satisfiesIsolation(this.isolation, requiredIsolation(effect))) continue;

      if (!capability.provenance.trusted) {
        throw new SandboxError("unsupported_isolation", {
          message:
            "Running code or reaching the network from a connected server needs a sandbox, and none is available yet.",
        });
      }

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

  /**
   * File metadata, for callers that need to detect a change rather than read
   * the whole file again.
   */
  async stat(path: string): Promise<SandboxFileStat> {
    const result = await stat(this.resolveRead(path));
    return {
      isFile: result.isFile(),
      isDirectory: result.isDirectory(),
      size: result.size,
      modifiedAt: result.mtimeMs,
    };
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
