import { readdir, readFile, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";

import type { CapabilityDescriptor } from "../contracts/capabilities.js";
import { runProcess, type ProcessResult } from "../process/exec.js";
import { SandboxError } from "./errors.js";
import {
  containCommand,
  hostIsolation,
  type ChildKind,
  type ContainedCommand,
  type IsolationSupport,
} from "./isolation/index.js";
import { resolveContainedPath } from "./paths.js";
import { createSandboxPolicy, type IsolationLevel, type SandboxPolicy } from "./policy.js";

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

/**
 * What a run produced, and one sentence the caller owes the person when the
 * command ran without a fence it was owed. See `ContainedCommand.note`.
 */
export interface SandboxRunResult extends ProcessResult {
  readonly note?: string;
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
 * OS fence when the person has turned one on and the host has it. Since ADR
 * 0057 the gate is the boundary: a host with no fence, or one that cannot
 * supply the fence it was asked for, runs the command under the gate alone
 * and says so beside the output, rather than refusing.
 */
export class LocalSandbox {
  /**
   * What this sandbox enforces *itself*, which is not what it can contain a
   * child with. Kept separate from {@link LocalSandbox.isolationSupport}
   * because collapsing them would let a machine with a working container claim
   * that `readFile` is OS-isolated, which it is not.
   */
  readonly isolation: IsolationLevel = "in-process";
  /**
   * Not readonly, and only because of {@link LocalSandbox.widen}: a folder
   * the person grants mid-run has to be reachable in the same run, or the
   * question they just answered buys nothing until the next message.
   */
  #policy: SandboxPolicy;
  /**
   * What this host can actually contain, measured once per sandbox.
   *
   * Injectable so the fenced and gate-only branches are both testable on one
   * machine, whatever that machine can do.
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

      // Whether the host can fence the effect is not asked here any more
      // (ADR 0057): a fence is extra, and a capability is offered on the
      // strength of the gate. The switches above are the whole answer.
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
  async run(kind: ChildKind, options: SandboxRunOptions): Promise<SandboxRunResult> {
    const command = await this.plan(kind, {
      executable: options.executable,
      args: options.args,
      cwd: options.cwd,
      ...(options.lineJoin === undefined ? {} : { lineJoin: options.lineJoin }),
      ...(options.programRoots === undefined ? {} : { programRoots: options.programRoots }),
      network: this.#policy.allowNetwork,
    });

    const result = await runProcess({
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
    return command.note === undefined ? result : { ...result, note: command.note };
  }

  /**
   * Everything a spawn needs, contained, without performing it.
   *
   * The one seam a background job goes through. `run` cannot serve it: it
   * resolves on the child's `close`, which is the whole thing a job exists
   * not to wait for. What must not be duplicated is the part above the spawn
   * - the isolation check asked at the moment of truth, and the environment
   * built from policy rather than inherited - so that is here and the caller
   * gets a descriptor it cannot assemble incorrectly.
   */
  async spawnPlan(
    kind: ChildKind,
    options: SandboxRunOptions,
  ): Promise<{
    readonly executable: string;
    readonly args: readonly string[];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
    /** See `ContainedCommand.note`. */
    readonly note?: string;
  }> {
    const command = await this.plan(kind, {
      executable: options.executable,
      args: options.args,
      cwd: options.cwd,
      ...(options.lineJoin === undefined ? {} : { lineJoin: options.lineJoin }),
      ...(options.programRoots === undefined ? {} : { programRoots: options.programRoots }),
      network: this.#policy.allowNetwork,
    });
    return {
      executable: command.executable,
      args: command.args,
      cwd: options.cwd,
      env: this.environment(),
      ...(command.note === undefined ? {} : { note: command.note }),
    };
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
    if (this.#policy.trusted) {
      return { executable: command.executable, args: command.args };
    }
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
   * Nothing, for the backend that remains: a namespace evaporates with the
   * process it contained. The hook stays on the seam because the Windows
   * backend it was written for (ADR 0041) did leave permission entries
   * behind, and a future backend that writes anything to the machine owes the
   * same undo.
   */
  async releaseIsolation(): Promise<void> {
    await this.#isolationSupport.backend?.release(this.#policy);
  }

  /**
   * Adds one root to what this sandbox may reach, for the rest of this run.
   *
   * What a granted folder question does once the person says yes. The row
   * the store wrote is what every later run reads at policy-build time; this
   * is the same grant applied to the run that asked, so "and the work can
   * carry on" is true in the sentence the person just read. Built through the
   * policy factory rather than by pushing onto the arrays, so the rule that a
   * writable root sits inside a readable one holds here as everywhere: a
   * write grant is a read grant too. A trusted sandbox reaches everything
   * already and is left as it is.
   */
  widen(root: string, mode: "read" | "write"): void {
    if (this.#policy.trusted) return;
    const absolute = resolve(root);
    const readRoots = this.#policy.readRoots.includes(absolute)
      ? this.#policy.readRoots
      : [...this.#policy.readRoots, absolute];
    const writeRoots =
      mode === "write" && !this.#policy.writeRoots.includes(absolute)
        ? [...this.#policy.writeRoots, absolute]
        : this.#policy.writeRoots;
    this.#policy = createSandboxPolicy({
      ...this.#policy,
      // The factory puts the workspace root first itself.
      readRoots: readRoots.filter((entry) => entry !== this.#policy.workspaceRoot),
      writeRoots,
    });
  }

  /** Resolves a path the agent may read, or refuses. */
  resolveRead(path: string): string {
    if (this.#policy.trusted) {
      return resolveTrustedPath(this.#policy.workspaceRoot, path);
    }
    return resolveContainedPath(
      this.#policy.workspaceRoot,
      path,
      this.#policy.readRoots,
    );
  }

  /** Resolves a path the agent may modify, or refuses. */
  resolveWrite(path: string): string {
    if (this.#policy.trusted) {
      return resolveTrustedPath(this.#policy.workspaceRoot, path);
    }
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

  /**
   * Moves one writable path to another, preserving the bytes exactly.
   *
   * Both endpoints resolve through `resolveWrite`, so a move can neither
   * start outside the writable roots nor land outside them - the same one
   * resolver every other filesystem operation goes through, asked twice
   * because a move names two paths.
   *
   * The workspace root is refused as either endpoint, for the reason
   * {@link LocalSandbox.remove} refuses it as a target: the root is where
   * this agent stands, and relocating it is not an operation anyone meant.
   * The destination's parents are created first, matching the contract
   * `writeFile` states and every caller of that relies on.
   *
   * Overwriting is deliberately not offered here. Windows does not replace
   * through rename anyway, and "move onto an existing file" is a decision
   * about discarding content, which belongs to the tool that can require the
   * file to have been read first.
   */
  async rename(from: string, to: string): Promise<void> {
    const source = this.resolveWrite(from);
    const target = this.resolveWrite(to);

    if (source === this.#policy.workspaceRoot || target === this.#policy.workspaceRoot) {
      throw new SandboxError("not_permitted", {
        message: "The workspace root cannot be moved.",
      });
    }

    await mkdir(dirname(target), { recursive: true });
    await rename(source, target);
  }
}

/**
 * Resolves any path for a trusted project, without a boundary.
 *
 * Trusted removes containment: the project's own files are no longer the
 * boundary. Relative paths still resolve against the workspace, so a bare
 * name keeps meaning the same file; absolute paths resolve to themselves.
 */
function resolveTrustedPath(workspaceRoot: string, requested: string): string {
  if (typeof requested !== "string" || requested.trim() === "") {
    throw new SandboxError("path_escape", {
      message: "A file path is required.",
    });
  }
  if (isAbsolute(requested)) return resolve(requested);
  return resolve(workspaceRoot, requested);
}
