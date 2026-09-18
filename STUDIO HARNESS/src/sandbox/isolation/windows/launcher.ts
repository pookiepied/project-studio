import { execFile, execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

import { shippedBinaryDirectory } from "../../../platform/paths.js";
import { SandboxError } from "../../errors.js";

/**
 * Talking to `studio-contain.exe`.
 *
 * The launcher is a shipped binary like `rg.exe`, found the same way and in the
 * same place, so there is one answer to "where do our programs live" rather
 * than a second convention for this one.
 *
 * ## Why `execFileSync` and not `runProcess`
 *
 * `runProcess` is the spawn point for work the *agent* asked for: it bounds
 * time, caps output and kills process trees, because the thing on the other end
 * was chosen by a model. These calls are none of that. They are short,
 * administrative, fixed-argument calls the harness makes about itself, and
 * routing them through `runProcess` would make `process/exec.ts` depend on the
 * sandbox that depends on it. The one property that matters — an argument
 * vector, never a command string, never a shell — is what `execFileSync` gives.
 */

/** Matches `[[bin]] name` in `native/windows-appcontainer/Cargo.toml`. */
const LAUNCHER_BINARY = "studio-contain.exe";

/**
 * How the launcher joins the child's arguments into one command line.
 *
 * The launcher's own vocabulary, spelled out here so the interpreter
 * descriptions in `src/process/interpreter.ts` can declare which one their
 * child needs without anyone guessing at the flag's spelling. `argv` is the
 * default and the only mode the programs we chose (git, rg) may ever use;
 * `command-line` is for an interpreter that reads the raw remainder of its
 * own line - `cmd.exe` after `/c` - and is wrong for everything else.
 */
export type LauncherJoin = "argv" | "command-line";

/**
 * Where the launcher is expected to be, whether or not it is there.
 *
 * Returns the path rather than throwing so `available()` can ask without
 * handling an exception, which is the difference between "measure this" and
 * "try it and see".
 */
export function launcherPath(vendorRoot = shippedBinaryDirectory()): string {
  // `win32-x64` matches the directory `rg.exe` already ships in. AppContainer
  // is a kernel feature and not an edition feature, so there is no second
  // Windows variant to carry — but there will be an `arm64` one, and the
  // existing layout already has a place to put it.
  return join(vendorRoot, `${process.platform}-${process.arch}`, LAUNCHER_BINARY);
}

export function launcherInstalled(vendorRoot = shippedBinaryDirectory()): boolean {
  return existsSync(launcherPath(vendorRoot));
}

/**
 * Runs one launcher subcommand and returns its stdout, trimmed.
 *
 * Throws `SandboxError("unavailable")` rather than letting a raw spawn error
 * out, because every caller here is answering "can this machine contain
 * anything" and a missing binary is one of the answers, not a crash.
 */
export function invokeLauncher(
  args: readonly string[],
  options: { readonly vendorRoot?: string } = {},
): string {
  const executable = launcherPath(options.vendorRoot ?? shippedBinaryDirectory());
  try {
    return execFileSync(executable, [...args], {
      encoding: "utf8",
      windowsHide: true,
      // A minute. Profile creation takes milliseconds, but a `grant` on a large
      // workspace makes Windows walk the tree pushing inheritance down, and 15
      // seconds was not enough — the first symptom was an `ETIMEDOUT` that read
      // exactly like a refusal, on a call that was working.
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (error) {
    throw new SandboxError("unavailable", {
      message: `The Windows sandbox launcher failed: ${describe(error)}`,
    });
  }
}

const execFileAsync = promisify(execFile);

/**
 * Runs one launcher subcommand without holding the event loop still.
 *
 * Same contract as {@link invokeLauncher} — argument vector, trimmed stdout,
 * `SandboxError("unavailable")` instead of a raw spawn error — but the call
 * awaits rather than blocks, and it exists because of what blocking costs here.
 * While `execFileSync` runs, the harness's one thread cannot write a byte: the
 * conversation's stream, the keep-alive comments written every fifteen seconds,
 * everything waits. A cold first grant of the preset roots was measured at a
 * hundred seconds of exactly that silence, which the client reads as a dead
 * stream and reports. The synchronous form stays for the quick administrative
 * calls — profile creation, `check`, the traverse corridor, where no tree is
 * walked — and every propagation-bearing grant goes through this one.
 */
export async function invokeLauncherAsync(
  args: readonly string[],
  options: { readonly vendorRoot?: string } = {},
): Promise<string> {
  const executable = launcherPath(options.vendorRoot ?? shippedBinaryDirectory());
  try {
    const { stdout } = await execFileAsync(executable, [...args], {
      encoding: "utf8",
      windowsHide: true,
      // Ten minutes, and only here. This wrapper exists for the calls that walk
      // trees, and the walk is the whole budget: the same `grant` that took a
      // minute warm took eighty seconds cold. The synchronous minute stays for
      // everything else — checks, profile operations, traverse entries — which
      // have no walk in them and fail in milliseconds when they fail at all.
      // The alternative to a generous ceiling is not a faster grant; it is a
      // killed child and a tree whose entries were pushed half way down, which
      // is a machine that has to be repaired by hand.
      timeout: 600_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return stdout.trim();
  } catch (error) {
    throw new SandboxError("unavailable", {
      message: `The Windows sandbox launcher failed: ${describe(error)}`,
    });
  }
}

/**
 * The argument vector for running a program inside a container.
 *
 * Split out from the spawn so it can be asserted on a machine that has no
 * launcher at all. The order matters - everything after `--` belongs to the
 * child, including anything that looks like one of the launcher's own flags -
 * and an order test is worth more than a comment saying so.
 */
export function containArgs(input: {
  readonly sid: string;
  readonly cwd: string;
  readonly executable: string;
  readonly args: readonly string[];
  /** Omitted means `argv`, the launcher's default. */
  readonly join?: LauncherJoin;
  readonly capabilities?: readonly string[];
}): readonly string[] {
  return [
    "run",
    "--sid",
    input.sid,
    "--cwd",
    input.cwd,
    ...(input.join === undefined || input.join === "argv"
      ? []
      : ["--join", input.join]),
    // Repeated rather than comma-joined. A list encoded into one string needs
    // an escape rule the first time a value contains the separator, and a
    // capability is not a thing to get subtly wrong.
    ...(input.capabilities ?? []).flatMap((name) => ["--capability", name]),
    "--",
    input.executable,
    ...input.args,
  ];
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    const stderr = (error as { stderr?: unknown }).stderr;
    // The launcher explains itself on stderr; its message is more useful than
    // "Command failed", which is all `Error.message` carries.
    if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
    return error.message;
  }
  return String(error);
}
