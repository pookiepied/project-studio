import { readdir, readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CapabilityDescriptor } from "../contracts/capabilities.js";
import { SandboxError } from "./errors.js";
import {
  assertIsolationAvailable,
  selectIsolation,
  type IsolationSupport,
} from "./isolation.js";
import { resolveContainedPath } from "./paths.js";
import {
  requiredIsolation,
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
  /**
   * What this host can actually contain, measured once per sandbox.
   *
   * Injectable so the enforcing branch is testable today, on a machine where
   * no backend exists. A refusal that cannot be exercised until the backend
   * ships is a refusal nobody has ever seen work.
   */
  readonly #isolationSupport: IsolationSupport;

  constructor(policy: SandboxPolicy, isolationSupport: IsolationSupport = selectIsolation()) {
    this.#policy = policy;
    this.#isolationSupport = isolationSupport;
  }

  /** What contained this sandbox's children, for diagnostics and honesty. */
  get isolationSupport(): IsolationSupport {
    return this.#isolationSupport;
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

  /**
   * Whether this sandbox can admit a capability at all.
   *
   * Asks two questions and deliberately not a third. It asks whether the
   * operator has switched this effect off, and whether we have the isolation
   * the effect wants. It does **not** ask who wrote the code.
   *
   * That third question used to live here, as `!provenance.trusted` refusing
   * anything connected. It was never a containment fact — it was a stand-in for
   * a consent path that did not exist yet, written when the only possible
   * answer to "a user connected this" was "we have nowhere safe to put it".
   *
   * Phase 11 builds that path: a server is installed by hand behind a dialog
   * that states the consequence, selected into a specific project, and asked
   * about on every call by a **policy** `ask` that no unattended mode can
   * resolve. The refusal moved to where it can be argued with; it did not
   * disappear. See ADR 0025.
   *
   * `S-02` is what makes the isolation branch below start refusing rather than
   * falling through — and it would then relax the per-call approval, which is
   * the opposite direction from what this file used to imply.
   */
  assertSupports(capability: CapabilityDescriptor): void {
    for (const effect of capability.effects) {
      // The operator's off switch, asked first and of every capability. It used
      // to sit behind the provenance check, so it never applied to the code it
      // most obviously describes. See ADR 0024 for why these default to on.
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

      // The shortfall is decided in one place now, and it is a decision rather
      // than a fall-through. This branch used to be an `if … continue` followed
      // by a comment explaining why nothing happened — true, and inert, and
      // impossible to act on.
      //
      // What makes running it anyway acceptable, while it *is* acceptable, is
      // decided in two other places on purpose: our own code was reviewed
      // before it shipped, and connected code was installed by hand and asks
      // again on every single call. What changed is that the harness now says
      // so by consulting `selectIsolation()`, so the day a backend exists this
      // starts refusing without anyone having to remember this line.
      assertIsolationAvailable(requiredIsolation(effect), this.#isolationSupport);
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
