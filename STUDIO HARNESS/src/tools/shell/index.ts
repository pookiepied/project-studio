import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import { ProcessError } from "../../process/errors.js";
import { ToolError } from "../errors.js";
import type { CallGate } from "../gate.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import {
  resolveProgram,
  shellResource,
  type ResolvedProgram,
} from "./resolve.js";

export { resolveProgram, shellResource } from "./resolve.js";

/**
 * Running a program the model chose.
 *
 * The name is a compromise with what models expect. There is no shell: this
 * runs one program with one argument vector, and `shell: false` is what makes
 * that true. Calling it `shell` and then refusing shell syntax is friction we
 * accept, because every model is trained to reach for a tool by that name and
 * an unfamiliar one goes unused.
 *
 * It declares `execute`, alone among the native tools, and that is the honest
 * label. `git` and `grep` run programs too, but we chose those programs; here
 * the model does. See ADR 0019 for what that costs and what still holds.
 */

/** 400 lines, matching git. Beyond this it is a dump, not an answer. */
const MAX_OUTPUT_LINES = 400;

/** Ten minutes. A build or a test run is the reason this tool exists. */
const MAX_TIMEOUT_MS = 600_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export interface ShellInput {
  readonly command: string;
  readonly args: readonly string[];
  /** A directory inside the project. Defaults to the project root. */
  readonly cwd: string | undefined;
  readonly timeoutMs: number | undefined;
  /**
   * The program, resolved once during parsing.
   *
   * Carried rather than re-derived. `parse`, `resource`, and `execute` each
   * used to call `resolveProgram`, which walks `PATH` and stats every
   * candidate — three times per call, for an answer that cannot change between
   * them. Worse than the cost: it could disagree with itself if `PATH` changed
   * mid-call, so the program authorized would not be the program run.
   */
  readonly program: ResolvedProgram;
}

export const SHELL_DESCRIPTOR: CapabilityDescriptor = {
  id: { namespace: "native", name: "shell" },
  title: "Run a program",
  description:
    "Runs one program and returns its output. Give the program and its arguments separately, " +
    'for example command "node" with args ["build.js"]. There is no shell, so pipes, ' +
    "redirects, &&, and quotes are not interpreted. Run one program per call.",
  inputSchema: {
    type: "object",
    properties: {
      command: { type: "string", minLength: 1 },
      args: { type: "array", items: { type: "string" } },
      cwd: { type: "string" },
      timeoutMs: { type: "number", minimum: 1000, maximum: 600000 },
    },
    required: ["command"],
    additionalProperties: false,
  },
  effects: ["execute"],
  provenance: NATIVE_PROVENANCE,
  // Running a program twice does whatever the program does twice.
  idempotent: false,
};

function clip(output: string): string {
  const lines = output.split("\n");
  if (lines.length <= MAX_OUTPUT_LINES) return output;

  return [
    ...lines.slice(0, MAX_OUTPUT_LINES),
    `\n[showing ${MAX_OUTPUT_LINES} of ${lines.length} lines]`,
  ].join("\n");
}

/**
 * What the model is told.
 *
 * Both streams, labelled, and the exit code always. A non-zero exit is a
 * result, not a failure — a failing test suite is the answer to the question
 * that was asked — so it is reported rather than thrown.
 */
function report(
  program: string,
  result: { exitCode: number; stdout: string; stderr: string },
): string {
  const parts: string[] = [];
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  if (stdout !== "") parts.push(stdout);
  if (stderr !== "") parts.push(`[stderr]\n${stderr}`);
  if (parts.length === 0) parts.push(`${program} produced no output.`);

  const clipped = clip(parts.join("\n\n"));
  if (result.exitCode !== 0) {
    return `${clipped}\n\n[exit code ${result.exitCode}]`;
  }
  return clipped;
}

export function createShellTool(): ToolDefinition<ShellInput, string> {
  return defineStudioTool({
    descriptor: SHELL_DESCRIPTOR,
    // The gate's default is two minutes, which is not a deadline for a build —
    // it is a guarantee the build fails. Declared here so the tool's own
    // ceiling and the gate's agree, instead of the shorter one winning
    // silently.
    deadlineMs: MAX_TIMEOUT_MS,
    // Matched like `git:push`, so a rule can allow `shell:node` without
    // allowing every program on the machine. A path-shaped match would glob
    // across separators and mean something nobody intended.
    resourceKind: "command",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;

      if (typeof value.command !== "string" || value.command.trim() === "") {
        throw new ToolError("invalid_input", {
          message: 'command is required, for example "node".',
        });
      }
      if (value.args !== undefined && !Array.isArray(value.args)) {
        throw new ToolError("invalid_input", {
          message:
            "args must be a list of separate arguments, not one string. " +
            'Use ["run", "build"], not "run build".',
        });
      }

      const args = (value.args ?? []) as unknown[];
      for (const argument of args) {
        if (typeof argument !== "string") {
          throw new ToolError("invalid_input", {
            message: "Every argument must be text.",
          });
        }
      }

      if (value.cwd !== undefined && typeof value.cwd !== "string") {
        throw new ToolError("invalid_input", { message: "cwd must be a path." });
      }

      let timeoutMs: number | undefined;
      if (value.timeoutMs !== undefined) {
        if (typeof value.timeoutMs !== "number" || !Number.isFinite(value.timeoutMs)) {
          throw new ToolError("invalid_input", {
            message: "timeoutMs must be a number of milliseconds.",
          });
        }
        // Clamped rather than refused. A model asking for an hour wants "a long
        // time", and refusing the call teaches it to guess again rather than to
        // ask for less.
        timeoutMs = Math.min(Math.max(value.timeoutMs, 1_000), MAX_TIMEOUT_MS);
      }

      // Resolved during parsing so an unrunnable program fails before the user
      // is asked to approve something that cannot work — and kept, so the
      // program that was authorized is the program that runs.
      const program = resolveProgram(value.command);

      return {
        command: value.command,
        args: args as readonly string[],
        cwd: value.cwd as string | undefined,
        timeoutMs,
        program,
      };
    },

    // The program, not the arguments. `shell:node` is a decision a person can
    // make; "node with these particular flags" is not, and offering it would
    // produce an approval that never matches the next call.
    resource: (input) => shellResource(input.program.name),

    execute: async (input, context) => {
      const program = input.program;

      // Through the sandbox, so a cwd escaping the project is refused here
      // rather than becoming the working directory of a real process.
      const cwd =
        input.cwd === undefined
          ? context.sandbox.policy.workspaceRoot
          : context.sandbox.resolveRead(input.cwd);

      try {
        // Through the sandbox rather than straight to `runProcess`, and the
        // kind is the whole point: `shell` is the one tool where the *model*
        // picks the executable, so it is the one that has to be contained. The
        // sandbox builds the environment from policy too, so there is no
        // remaining way for this call site to hand the program the machine's
        // tokens by forgetting a field.
        const result = await context.sandbox.run("shell", {
          executable: program.path,
          args: [...input.args],
          cwd,
          timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
          ...(context.signal ? { signal: context.signal } : {}),
        });

        return report(program.name, result);
      } catch (error) {
        if (error instanceof ProcessError && error.kind === "timeout") {
          return `${program.name} was still running after the time limit and was stopped.`;
        }
        if (error instanceof ProcessError && error.kind === "output_limit") {
          return `${program.name} produced too much output and was stopped. Narrow what it prints.`;
        }
        if (error instanceof ToolError) throw error;
        throw new ToolError("execution_failed", {
          message: `${program.name} could not be started.`,
          cause: error,
        });
      }
    },
  });
}

/**
 * The execution family.
 *
 * Registered separately from every other family, because this is the one whose
 * availability depends on the sandbox policy rather than on the tool. A
 * `LocalSandbox` without `allowExec` refuses it at the gate.
 */
export function registerShellTools(gate: CallGate): void {
  gate.register(createShellTool());
}
