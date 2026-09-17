import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
} from "../../contracts/capabilities.js";
import {
  demoteInterpreter,
  interpreterStarted,
  markInterpreterStarted,
  resolveInterpreter,
  type Interpreter,
} from "../../process/interpreter.js";
import { ProcessError } from "../../process/errors.js";
import type { LocalSandbox } from "../../sandbox/local-sandbox.js";
import { SandboxError } from "../../sandbox/errors.js";
import { ToolError } from "../errors.js";
import type { CallGate } from "../gate.js";
import { defineStudioTool, type ToolDefinition } from "../types.js";
import { readCommandPrograms } from "./command.js";
import { programDirectories, shellResource } from "./resolve.js";
import { createJobsTool } from "./jobs.js";
import type { BackgroundJobs } from "../../process/background.js";
import type { MediaJobs } from "../../gateway/media/jobs.js";

export { shellResource } from "./resolve.js";

/**
 * Running the command line the model wrote.
 *
 * The name is a compromise with what models expect, and so - since ADR 0046 -
 * is the shape: this takes a command line and runs it through one
 * interpreter, chosen for the machine in `src/process/interpreter.ts` and
 * stated in the environment block. It used to take a program plus an argument
 * vector and refuse interpreters outright, which on Windows meant `npm`,
 * `pnpm`, `yarn`, and `tsc` - all `.cmd` shims - could not run at all. The
 * refusal was honest and the tool was useless for the most common package
 * manager on the most common desktop.
 *
 * What the interpreter changes is what a command can *express*. What it
 * cannot change is what a command can *reach*: the interpreter's children
 * carry the same kernel token and the same grants as any program this tool
 * started before it. That argument is ADR 0041's, checked rather than
 * assumed; the amendment in ADR 0046 records where it bends.
 *
 * It still declares `execute`, alone among the native tools, and that is
 * still the honest label: `git` and `grep` run programs we chose, and here
 * the model does.
 */

/** 400 lines, matching git. Beyond this it is a dump, not an answer. */
const MAX_OUTPUT_LINES = 400;

/** Ten minutes. A build or a test run is the reason this tool exists. */
const MAX_TIMEOUT_MS = 600_000;

/**
 * `STATUS_DLL_INIT_FAILED` (0xC0000142), as Windows reports it through an exit
 * code. The process was created and then died initialising its libraries, so
 * it never read the command line - which is what makes retrying it with
 * another interpreter safe rather than a second attempt at whatever the line
 * asked for.
 */
const STATUS_DLL_INIT_FAILED = 3_221_225_794;
const DEFAULT_TIMEOUT_MS = 120_000;
/** Long enough for a shell to start and exit, short enough not to stall a turn. */
const PROBE_TIMEOUT_MS = 15_000;

interface ShellInput {
  /** A full command line, for the machine's interpreter. */
  readonly command: string;
  /** A directory inside the project. Defaults to the project root. */
  readonly cwd: string | undefined;
  readonly timeoutMs: number | undefined;
  /** Start it and return, instead of waiting for it to finish. */
  readonly background: boolean;
  /**
   * Every program the line starts, in the order it names them.
   *
   * Read at parse time by `command.ts`, which refuses a line it cannot see
   * through - a refusal at parse time is one the user is never asked to
   * approve, because there is nothing yet to approve.
   */
  readonly programs: readonly string[];
  /** The interpreter this machine runs the line with, resolved once. */
  readonly interpreter: Interpreter;
}

/**
 * What the tool says about itself before the machine is consulted.
 *
 * Deliberately does not name a shell or a separator. Which shell this is
 * differs per machine, and a description that names the wrong one is worse
 * than one that names none: the model writes for what it was told.
 */
const SHELL_DESCRIPTION =
  "Runs one command line through this machine's shell, for example " +
  '"npm test". The shell interprets pipes, quotes, and redirection. A line ' +
  "that names several programs - as a chain does - is approved for each of " +
  "them.\n\n" +
  // Said here rather than left to be discovered, because discovering it costs
  // a full timeout and returns nothing: a server started in the foreground
  // holds the call until the limit and then has its output thrown away with
  // the failure.
  "Set background: true for a command that is not meant to finish - a dev " +
  "server, a watcher, a long download. It returns a job id at once; use " +
  "the jobs tool to read its output or stop it. You will be told when a " +
  "background command ends, so there is no need to keep checking on one - " +
  "start it, carry on with the work, and read its output when you hear. " +
  "Do not try to detach a " +
  "command yourself: a line that launches something into the background " +
  "still hands it these pipes, so this tool waits for it either way.";

const SHELL_SCHEMA = {
  type: "object",
  properties: {
    command: { type: "string", minLength: 1 },
    cwd: { type: "string" },
    timeoutMs: { type: "number", minimum: 1000, maximum: 600000 },
    background: { type: "boolean" },
  },
  required: ["command"],
  additionalProperties: false,
} as const;

/**
 * The descriptor, told which interpreter this machine actually has.
 *
 * The description used to offer `npm run build && node check.js` as its
 * example on every machine. On the two Windows fallbacks that line does not
 * run: `cmd.exe` honours `&&` but not `;`, and Windows PowerShell 5.1 honours
 * `;` but neither `&&` nor `||`. The tool was teaching a syntax the shell it
 * had chosen would reject, and then refusing the result - so the description
 * names the interpreter and splices in the same statement the environment
 * block uses, rather than a second copy that can disagree with it.
 *
 * An undefined interpreter is a real state - a machine with no shell at all -
 * and it gets the interpreter-independent description rather than a guess.
 */
function shellDescriptor(interpreter: Interpreter | undefined): CapabilityDescriptor {
  const description =
    interpreter === undefined
      ? SHELL_DESCRIPTION
      : [
          SHELL_DESCRIPTION,
          "",
          ...interpreter.statement,
          "",
          `Separate commands with ${interpreter.separators.join(" or ")}. Any other ` +
            "separator is refused rather than run, because this shell would not " +
            "honour it.",
        ].join("\n");

  return {
    id: { namespace: "native", name: "shell" },
    title: "Run a command line",
    description,
    inputSchema: SHELL_SCHEMA,
    effects: ["execute"],
    provenance: NATIVE_PROVENANCE,
    // Running a command twice does whatever it does twice.
    idempotent: false,
  };
}

/**
 * The interpreter-independent descriptor: identity, effects, and schema, which
 * is what the permission tables and the effect rules are about. Callers that
 * want the sentence a model reads build it with {@link shellDescriptor}.
 */
export const SHELL_DESCRIPTOR: CapabilityDescriptor = shellDescriptor(undefined);

/**
 * Whether a demotion invalidates the approval that was already given.
 *
 * The retry after `STATUS_DLL_INIT_FAILED` reuses the authorization from the
 * first attempt, which is right only while the second interpreter would start
 * the same programs as the first. It does not always. The line was read with
 * bash's separators, bash could not be contained, and the fallback is
 * `cmd.exe` - which does not honour `;`. So `git status; git push` was read as
 * two commands, approved as two, and then handed to a shell that runs one of
 * them with a stray argument. The user approved a push that never happened,
 * which is the quieter half of the same bug: an approval that does not
 * describe what ran is not an approval of it.
 *
 * Returns the sentence to refuse with, or undefined when the retry is safe -
 * which it is whenever the separators the line actually uses are honoured by
 * both. Re-reading rather than comparing separator lists, because the only
 * question that matters is what this line does, and most lines use none.
 */
function demotionRefusal(
  input: ShellInput,
  from: Interpreter,
  to: Interpreter,
): string | undefined {
  let programs: readonly string[];
  try {
    programs = readCommandPrograms(input.command, to);
  } catch {
    return (
      `The command could not be started in ${from.label}, and this machine's ` +
      `next shell is ${to.label}, which reads this line differently. It was ` +
      `not retried. Rewrite the command for ${to.label} and call again.`
    );
  }

  const same =
    programs.length === input.programs.length &&
    programs.every((program, index) => program === input.programs[index]);
  if (same) return undefined;

  return (
    `The command could not be started in ${from.label}, and in ${to.label} the ` +
    `same line runs ${programs.join(", ")} rather than ${input.programs.join(", ")}. ` +
    `Only the first was approved, so nothing was run. Rewrite the command for ` +
    `${to.label} and call again.`
  );
}

/** The first non-empty line of a stream, or undefined when it carried nothing. */
function firstLine(text: string): string | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed !== "") return trimmed;
  }
  return undefined;
}

/**
 * What the model is told when the shell it was promised dies unstarted.
 *
 * The tool is registered under the interpreter the machine resolved first, so
 * the description the model has already read names that shell, and from here
 * on it runs under the next one. A description that says bash while the line
 * is read by cmd is how `a ; b` becomes one command with a stray argument,
 * so the note says which shell died - the first line it printed, which is
 * the diagnostic, rather than the whole stream - and which one the rest of
 * the session uses, with that shell's own statement of what it can and
 * cannot do. The same lines the environment block carries, so the two cannot
 * disagree about it.
 */
export function demotionNote(
  from: Interpreter,
  to: Interpreter,
  stderr: string | undefined,
): string {
  const fatal = stderr === undefined ? undefined : firstLine(stderr);
  const death =
    fatal === undefined
      ? `${from.label} could not be contained on this machine: the child died in its own library loader (exit ${String(STATUS_DLL_INIT_FAILED)}), before reading the line.`
      : `${from.label} could not be contained on this machine: the child died in its own library loader (exit ${String(STATUS_DLL_INIT_FAILED)}), before reading the line: "${fatal}".`;
  return [
    death,
    "",
    `The rest of this session runs through ${to.label} instead.`,
    ...to.statement,
  ].join("\n");
}

/**
 * Whether the interpreter itself can start under containment.
 *
 * `exit 0` reaches no program in any of the shells this harness uses, so the
 * only thing that can fail it is the shell's own loader - which is exactly
 * the question. No program roots are granted, for the same reason: anything
 * granted would widen what the probe proves.
 *
 * A success is recorded, so this runs at most once per interpreter per
 * process. Any error is read as "it started" rather than "it did not": the
 * probe exists to *withhold* a permanent, process-wide demotion, and a
 * demotion taken because a probe timed out would be the original bug with an
 * extra step.
 */
export async function interpreterCanStart(
  sandbox: LocalSandbox,
  interpreter: Interpreter,
  cwd: string,
): Promise<boolean> {
  try {
    const probe = await sandbox.run("shell", {
      executable: interpreter.path,
      args: [...interpreter.args, "exit 0"],
      cwd,
      lineJoin: interpreter.takes,
      programRoots: [],
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    const ok = probe.exitCode !== STATUS_DLL_INIT_FAILED;
    if (ok) markInterpreterStarted(interpreter);
    return ok;
  } catch {
    return true;
  }
}

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
 * result, not a failure - a failing test suite is the answer to the question
 * that was asked - so it is reported rather than thrown.
 */
function report(
  result: { exitCode: number; stdout: string; stderr: string },
): string {
  const parts: string[] = [];
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();

  if (stdout !== "") parts.push(stdout);
  if (stderr !== "") parts.push(`[stderr]\n${stderr}`);
  if (parts.length === 0) parts.push(`The command produced no output.`);

  const clipped = clip(parts.join("\n\n"));
  if (result.exitCode !== 0) {
    return `${clipped}\n\n[exit code ${result.exitCode}]`;
  }
  return clipped;
}

export interface ShellToolOptions {
  /**
   * The registry background commands are kept in. Omitted, `background: true`
   * is refused with a sentence saying so rather than quietly running in the
   * foreground - a caller that asked not to wait must not be made to wait.
   */
  readonly jobs?: BackgroundJobs;
  /**
   * The registry generation jobs are kept in, when this harness has media.
   *
   * The jobs tool reads both: one listing, one way to check a job's
   * progress, one Stop - the conversation's background work in one place,
   * which is the reason the tool exists twice over.
   */
  readonly mediaJobs?: MediaJobs;
}

function createShellTool(
  options: ShellToolOptions = {},
): ToolDefinition<ShellInput, string> {
  return defineStudioTool({
    // Built from the interpreter this machine resolved, so the sentence the
    // model reads names the shell that will actually run its line.
    descriptor: shellDescriptor(resolveInterpreter()),
    // The gate's default is two minutes, which is not a deadline for a build -
    // it is a guarantee the build fails. Declared here so the tool's own
    // ceiling and the gate's agree, instead of the shorter one winning
    // silently.
    deadlineMs: MAX_TIMEOUT_MS,
    // Matched like `git:push`, so a rule can allow `shell:npm` without
    // allowing every program on the machine. A path-shaped match would glob
    // across separators and mean something nobody intended.
    resourceKind: "command",

    parse: (input) => {
      const value = (input ?? {}) as Record<string, unknown>;

      if (typeof value.command !== "string" || value.command.trim() === "") {
        throw new ToolError("invalid_input", {
          message: 'command is required, for example "npm test".',
        });
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

      // The interpreter first, because the reader needs it: which separators
      // split this line is a property of the shell that will run it, and
      // reading without knowing names programs that never run.
      const interpreter = resolveInterpreter();
      if (interpreter === undefined) {
        throw new ToolError("unavailable", {
          message: "This machine has no command interpreter the shell tool can run.",
        });
      }

      // Read before authorization, for the same reason the program used to be
      // resolved there: a line the reader refuses is one the user is never
      // shown for approval.
      const programs = readCommandPrograms(value.command, interpreter);

      if (value.background !== undefined && typeof value.background !== "boolean") {
        throw new ToolError("invalid_input", { message: "background must be true or false." });
      }

      return {
        command: value.command,
        cwd: value.cwd,
        timeoutMs,
        background: value.background === true,
        programs,
        interpreter,
      };
    },

    // Every program the line names, each authorized under its own name. The
    // singular `resource` is the first one, so the snapshot and any caller
    // that wants one label for the call keep a stable answer.
    resource: (input) => shellResource(input.programs[0] as string),
    resources: (input) => input.programs.map((program) => shellResource(program)),

    execute: async (input, context) => {
      let interpreter = input.interpreter;

      // Through the sandbox, so a cwd escaping the project is refused here
      // rather than becoming the working directory of a real process.
      const cwd =
        input.cwd === undefined
          ? context.sandbox.policy.workspaceRoot
          : context.sandbox.resolveRead(input.cwd);

      // Checked here, by name, because the alternative is a sentence with no
      // subject. A cwd that does not exist used to surface as "The command
      // could not be started in cmd." - true, and useless: it names neither
      // the path nor the reason. In an evaluation run that message cost two
      // false diagnoses, first that the cwd parameter was broken and then that
      // a directory was somehow invisible, when the real cause was a typo in
      // the directory name. An error that does not name what it could not find
      // sends the reader looking for the fault somewhere else.
      if (!(await context.sandbox.exists(cwd))) {
        throw new ToolError("invalid_input", {
          message:
            `The working directory does not exist: ${cwd}. Check the path, ` +
            "or create it before running the command.",
        });
      }

      // A contained interpreter finds its programs by walking the PATH the
      // policy granted, and can only find one in a directory the container
      // may read. The shell resolves every name the line runs through that
      // same PATH and hands the resolved directories to containment as read
      // program roots - so `node` is found before the line runs, not after
      // the shell has already said `not recognized`. A name that resolves
      // nowhere is left alone: it may be a builtin the interpreter runs
      // without touching the disk, and guessing which is a refusal built on
      // a guess (ADR 0047).
      const granted = programDirectories(
        input.programs,
        context.sandbox.policy.environment.PATH ?? "",
        context.sandbox.policy.environment.PATHEXT,
      );

      if (input.background) {
        const jobs = options.jobs;
        if (jobs === undefined) {
          throw new ToolError("unavailable", {
            message:
              "This composition cannot run background commands. Run it in the " +
              "foreground with a timeout instead.",
          });
        }
        // The interpreter is proven before the job exists: a background bash
        // that cannot be contained dies in its loader inside the registry,
        // where there is no retry point and the death reads as the job having
        // failed. The probe runs at most once per interpreter per process, so
        // this costs one spawn only when nobody has proved this interpreter
        // yet. The approval was given for what this line runs; reusing it
        // under the next shell is only honest while it runs the same
        // programs, which is the same refusal the foreground path asks.
        let backgroundNote: string | undefined;
        if (
          !interpreterStarted(interpreter) &&
          !(await interpreterCanStart(context.sandbox, interpreter, cwd))
        ) {
          if (demoteInterpreter(interpreter)) {
            const next = resolveInterpreter();
            if (next !== undefined && next !== interpreter) {
              const refusal = demotionRefusal(input, interpreter, next);
              if (refusal !== undefined) return refusal;
              backgroundNote = demotionNote(interpreter, next, undefined);
              interpreter = next;
            }
          }
        }
        try {
          const plan = await context.sandbox.spawnPlan("shell", {
            executable: interpreter.path,
            args: [...interpreter.args, input.command],
            cwd,
            lineJoin: interpreter.takes,
            programRoots: granted.directories,
          });
          const started = jobs.start({
            ...plan,
            command: input.command,
            conversationId: context.scope.conversationId,
          });
          return [
            `Started ${started.id} in the background: ${input.command}`,
            "",
            "It is running now and this call did not wait for it. Read its " +
              `output with jobs {"id": "${started.id}"}, and stop it with ` +
              `jobs {"id": "${started.id}", "stop": true} when you are done ` +
              "with it.",
            ...(backgroundNote === undefined ? [] : ["", backgroundNote]),
          ].join("\n");
        } catch (error) {
          if (error instanceof ToolError) throw error;
          if (error instanceof SandboxError) {
            return [
              `The command runs ${input.programs.join(", ")}, and the sandbox ` +
                "could not make everything it needs readable, so nothing ran.",
              error.message,
            ].join("\n");
          }
          throw new ToolError("execution_failed", {
            message: `The command could not be started in ${interpreter.label}.`,
            cause: error,
          });
        }
      }

      try {
        // Through the sandbox rather than straight to `runProcess`, and the
        // kind is the whole point: the model writes the command line, so this
        // is the one tool whose children exist only because the model asked.
        // The sandbox builds the environment from policy too, so there is no
        // remaining way for this call site to hand the interpreter the
        // machine's tokens by forgetting a field.
        const spawn = async (): Promise<{
          exitCode: number;
          stdout: string;
          stderr: string;
        }> =>
          context.sandbox.run("shell", {
            executable: interpreter.path,
            args: [...interpreter.args, input.command],
            cwd,
            // The line the interpreter reads is handed over the way that
            // interpreter reads lines, declared where the interpreter is
            // described. A `cmd.exe` takes the raw remainder after `/c` and
            // takes its quotes itself; escaping them for it is what turned a
            // fully-qualified path into `'\"C:\Program Files\nodejs\node.exe\"'
            // is not recognized` on every machine this tool was broken on.
            lineJoin: interpreter.takes,
            programRoots: granted.directories,
            timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
            ...(context.signal ? { signal: context.signal } : {}),
          });

        let result = await spawn();

        // The interpreter could not start. Retried, once, with the next
        // interpreter this machine has - and safe to retry precisely because
        // this status means the child died in its own loader, before it read
        // the command line, so nothing the line asks for has happened.
        //
        // The case is real and was costing every command on this machine: on
        // Windows without PowerShell 7 the choice is Git's `bash.exe`, which
        // cannot run inside a container, and the answer is to use an
        // interpreter that does not need what it cannot read.
        if (result.exitCode !== STATUS_DLL_INIT_FAILED) {
          // It ran. Exit code 1 is still a shell that started, and that is the
          // fact worth keeping: it makes every later failure with the loader
          // status attributable to the child instead of to the shell.
          markInterpreterStarted(interpreter);
        }

        // Whose loader actually failed. An interpreter reports its child's
        // exit code as its own, so this status alone cannot tell "the shell
        // could not start" from "the shell started and the program it ran
        // could not". On this machine `tar --version` under cmd exits with
        // exactly it - and demotion is permanent and process-wide, so reading
        // that as a broken cmd moved every later command to PowerShell 5.1,
        // where npm, npx and pnpm are all refused by the execution policy.
        //
        // Measured rather than inferred: if the interpreter is known to have
        // started, the child owns the failure and nothing is demoted. If it
        // has never started, it is asked to run a line that reaches no
        // program at all, which only its own loader can fail.
        const shellItself =
          result.exitCode === STATUS_DLL_INIT_FAILED && !interpreterStarted(interpreter)
            ? !(await interpreterCanStart(context.sandbox, interpreter, cwd))
            : false;

        if (shellItself && demoteInterpreter(interpreter)) {
          const next = resolveInterpreter();
          if (next !== undefined && next !== interpreter) {
            // The approval was given for what this line runs under the first
            // interpreter. Reusing it under the second is only honest while
            // the second starts the same programs.
            const refusal = demotionRefusal(input, interpreter, next);
            if (refusal !== undefined) return refusal;
            // The dead attempt's own stream is the diagnostic, and the
            // retry's answer would throw it away: the note carries both, so
            // the model learns which shell died and which one the rest of the
            // session uses, in the same breath as the command's answer.
            const note = demotionNote(interpreter, next, result.stderr);
            interpreter = next;
            result = await spawn();
            return [report(result), "", note].join("\n");
          }
        }

        return report(result);
      } catch (error) {
        if (error instanceof ProcessError && error.kind === "timeout") {
          return `The command was still running after the time limit and was stopped.`;
        }
        if (error instanceof ProcessError && error.kind === "output_limit") {
          return `The command produced too much output and was stopped. Narrow what it prints.`;
        }
        if (error instanceof ToolError) throw error;
        // A sandbox shortfall - a program directory the runtime cannot make
        // readable, a permission list that is full, a corridor that needs one
        // elevated setup run - is an answer, not a crash. The message names
        // what is missing and the exact command that fixes it, so returning it
        // is how the model can tell a person what to do instead of reporting a
        // failure with nowhere to go.
        if (error instanceof SandboxError) {
          const programs = input.programs.join(", ");
          return [
            `The command runs ${programs}, and the sandbox could not make ` +
              `everything it needs readable, so nothing ran.`,
            error.message,
          ].join("\n");
        }
        throw new ToolError("execution_failed", {
          message: `The command could not be started in ${interpreter.label}.`,
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
export function registerShellTools(gate: CallGate, options: ShellToolOptions = {}): void {
  gate.register(createShellTool(options));
  // Registered whenever there are background commands to keep, and covering
  // the generation registry too when there is one: one tool for the
  // conversation's background work, whatever kind of waiting it does.
  if (options.jobs !== undefined) {
    if (options.mediaJobs === undefined) gate.register(createJobsTool(options.jobs));
    else gate.register(createJobsTool(options.jobs, options.mediaJobs));
  }
}
