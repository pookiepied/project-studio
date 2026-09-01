import { readdir, readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { CapabilityDescriptor } from "../contracts/capabilities.js";
import { runProcess, type ProcessResult } from "../process/exec.js";
import { SandboxError } from "./errors.js";
import {
  assertIsolationAvailable,
  containCommand,
  hostIsolation,
  isolationForKind,
  type ChildKind,
  type ContainedCommand,
  type IsolationSupport,
} from "./isolation/index.js";
import { resolveContainedPath } from "./paths.js";
import {
  requiredIsolation,
  type IsolationLevel,
  type SandboxPolicy,
} from "./policy.js";

/**
 * A command to run, minus everything the sandbox already knows.
 *
 * No `env`: that is built from the policy, here, so no caller can assemble one.
 * `RunProcessOptions` without the fields a sandbox owns, rather than a partial
 * of it, so adding a field there does not silently open a hole here.
 */
export interface SandboxRunOptions {
  /** Absolute path to a real executable, already resolved. */
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /**
   * How the launcher joins the arguments, when the child is contained.
   *
   * The only caller that sets anything but the default is the shell tool,
   * whose interpreter reads a command line rather than an argv. See
   * `ContainmentRequest.lineJoin`.
   */
  readonly lineJoin?: "argv" | "command-line";
  /**
   * Directories the child must be able to read to run - its own program
   * files, granted read-only. See `program-roots.ts`.
   */
  readonly programRoots?: readonly string[];
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
}

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
 * Its own enforcement is `in-process` and always was: it constrains what *our*
 * code does on the agent's behalf, which is effective against an agent that
 * goes off-track — the realistic failure — and is no boundary at all against a
 * subprocess, which is outside our checks entirely.
 *
 * What changed in Stage 4b is that the subprocess is no longer left there.
 * {@link LocalSandbox.run} hands anything the harness did not choose to a real
 * OS container when the host has one, and refuses when the build expects one
 * and the machine cannot supply it. Where it still admits `execute`
 * uncontained, it does so because no backend exists for this platform yet —
 * stated as data in `isolation/registry.ts`, not as a comment.
 */
export class LocalSandbox {
  /**
   * What this sandbox enforces *itself*, which is not what it can contain a
   * child with. Kept separate from {@link LocalSandbox.isolationSupport}
   * because collapsing them would let a machine with a working container claim
   * that `readFile` is OS-isolated, which it is not.
   */
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

  constructor(policy: SandboxPolicy, isolationSupport: IsolationSupport = hostIsolation()) {
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

  /**
   * Starts a child process under whatever containment its kind is owed.
   *
   * **The one door for anything the harness did not choose.** `runProcess` is
   * still the single spawn point and still does the bounding — timeouts, output
   * caps, tree kills — but it takes a command and has no idea who picked it.
   * That question is answered here, where the policy lives, because the answer
   * needs the workspace's roots and the machine's measured support and neither
   * of those belongs in `process/exec.ts`.
   *
   * First-party tools keep calling `runProcess` directly, and that is correct
   * rather than an omission: `isolationForKind("tool")` is `in-process`, so
   * routing `git` through here would be ceremony that changes nothing — except
   * that `git` is what the snapshot system runs, and containing it would take
   * undo down with it. `architecture.test.ts` is what keeps a *new* execute
   * capability from quietly reaching for `runProcess` instead of this.
   */
  async run(kind: ChildKind, options: SandboxRunOptions): Promise<ProcessResult> {
    const required = isolationForKind(kind);
    // The same refusal `assertSupports` raises, asked again at the moment of
    // truth. A capability list built minutes ago is a description; this is the
    // spawn, and it is worth re-asking on the path that actually starts code.
    assertIsolationAvailable(required, this.#isolationSupport);

    const command = await this.plan(kind, {
      executable: options.executable,
      args: options.args,
      cwd: options.cwd,
      ...(options.lineJoin === undefined ? {} : { lineJoin: options.lineJoin }),
      ...(options.programRoots === undefined ? {} : { programRoots: options.programRoots }),
      network: this.#policy.allowNetwork,
    });

    return runProcess({
      executable: command.executable,
      args: command.args,
      cwd: options.cwd,
      // Built here rather than by the caller. A tool that assembled its own
      // environment could forget, and forgetting means the child inherits every
      // token on the machine — see ADR 0039.
      env: this.environment(),
      ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
      ...(options.maxOutputBytes === undefined ? {} : { maxOutputBytes: options.maxOutputBytes }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
    });
  }

  /**
   * The command that {@link LocalSandbox.run} would actually spawn.
   *
   * Public because "what does containment do to this command" is worth being
   * able to ask without starting a process — for a diagnostic, and for a test
   * that can then run on a machine with no backend at all. It also keeps `run`
   * to one readable path: decide, then spawn.
   */
  async plan(
    kind: ChildKind,
    command: {
      readonly executable: string;
      readonly args: readonly string[];
      readonly cwd?: string;
      /** How the launcher joins the arguments. See `SandboxRunOptions`. */
      readonly lineJoin?: "argv" | "command-line";
      /** Read-only grants for the program's own files. See `program-roots.ts`. */
      readonly programRoots?: readonly string[];
      /** Defaults to the policy switch, which is the operator's answer. */
      readonly network?: boolean;
    },
  ): Promise<ContainedCommand> {
    return containCommand(
      kind,
      {
        policy: this.#policy,
        executable: command.executable,
        args: command.args,
        cwd: command.cwd ?? this.#policy.workspaceRoot,
        network: command.network ?? this.#policy.allowNetwork,
        ...(command.lineJoin === undefined ? {} : { lineJoin: command.lineJoin }),
        ...(command.programRoots === undefined ? {} : { programRoots: command.programRoots }),
      },
      this.#isolationSupport,
    );
  }

  /**
   * Removes what containment left on the user's machine for this workspace.
   *
   * On Windows that is a permission entry on their project directory and a
   * profile registered with the OS. Neither is large and neither is hidden, but
   * a feature that only ever adds to a security descriptor is a feature that
   * grows without bound, so the removal exists and is reachable — `pnpm
   * sandbox:release` in `sandbox/cli.ts` is its delivery path.
   */
  async releaseIsolation(): Promise<void> {
    await this.#isolationSupport.backend?.release(this.#policy);
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
   *
   * Deliberately *not* routed through `buildEnvironment`, which is the MCP and
   * tool-child path and adds a short list of OS variables of its own. This one
   * passes through exactly what the policy names and nothing else, which two
   * tests in `sandbox.test.ts` pin by name. Anything a contained command needs
   * — `PATH` to find programs, `PATHEXT` to know that `node` means `node.exe`
   * — is granted deliberately where the policy is built, not acquired here by
   * a side effect.
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
