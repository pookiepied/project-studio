import { statSync } from "node:fs";
import { delimiter, join } from "node:path";

import { resolveBinary } from "../vendor/resolver.js";

/**
 * Which command interpreter this machine runs the shell tool's lines with.
 *
 * ADR 0046. The shell tool used to refuse interpreters outright: it ran one
 * program with one argument vector, and `.cmd` shims were refused by name.
 * Now it takes a command line, and something has to *be* the interpreter. The
 * model does not choose it - this module does, once per process - and the
 * choice is stated in the environment block, so the model writes the syntax
 * the machine will actually interpret instead of guessing.
 *
 * **The order prefers syntax models write.** Models reach for POSIX syntax
 * first (`&&`, pipes, `$VARS`), PowerShell second, cmd last. On Windows that
 * means: PowerShell 7 if installed, then the bash that ships with Git for
 * Windows (found beside the git binary this harness already resolves), then a
 * `bash.exe` on PATH, then Windows PowerShell 5.1, then cmd. The 5.1 fallback
 * is picked only when nothing better exists, and its `&&` gap is a stated
 * fact in the environment block rather than a surprise - which is the whole
 * difference between choosing it and silently trading one confusing failure
 * for another.
 *
 * Lives in `src/process/` rather than beside the shell tool because the
 * environment block needs the same answer, and a second copy of "which shell
 * is this" is how the block and the tool drift apart. It spawns nothing and
 * imports no spawn point; it only locates, the way `resolveProgram` did.
 */

export type InterpreterKind = "pwsh" | "bash" | "powershell" | "cmd" | "sh";

export interface Interpreter {
  /** Absolute path to a real executable, as `runProcess` requires. */
  readonly path: string;
  /** Human name for reporting, e.g. in the tool's own output labels. */
  readonly label: string;
  readonly kind: InterpreterKind;
  /** Arguments that put the interpreter into read-a-line-and-run mode. */
  readonly args: readonly string[];
  /**
   * How the environment block states the choice, as lines to splice in.
   *
   * Says what syntax is interpreted, and for the fallbacks that cannot
   * interpret all of it, says exactly what is missing.
   */
  readonly statement: readonly string[];
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** The Windows system directory, without depending on PATH for it. */
function systemRoot(): string {
  return (process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows").replace(/\\$/, "");
}

/**
 * Walks PATH for one file. Locating, not handing over: the interpreter's own
 * child gets PATH only where the policy grants it (ADR 0039).
 */
function scanPath(file: string): string | undefined {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const directory = entry.trim().replace(/^"|"$/g, "");
    if (directory === "" || !/^(?:[a-z]:)?[\\/]/i.test(directory)) continue;
    const candidate = join(directory, file);
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

/**
 * The bash that ships with Git for Windows, found beside the git binary the
 * harness resolves anyway.
 *
 * `bash.exe` is rarely on Windows PATH even where Git is - the installer puts
 * `Git\cmd` there, not `Git\bin` - so the derivation walks up from wherever
 * git actually is. A `bash.exe` under System32 is WSL and is never chosen:
 * its filesystem, paths, and network are another machine's.
 */
function bashFromGit(): string | undefined {
  let gitPath: string;
  try {
    gitPath = resolveBinary("git").path;
  } catch {
    return undefined;
  }
  const root = gitPath.replace(/[\\/](?:cmd|mingw64|bin)[\\/]git\.exe$/i, "");
  if (root === gitPath) return undefined;
  for (const candidate of [join(root, "bin", "bash.exe"), join(root, "usr", "bin", "bash.exe")]) {
    if (isFile(candidate)) return candidate;
  }
  return undefined;
}

/** A PATH bash that is not the WSL one in System32. */
function bashFromPath(): string | undefined {
  const found = scanPath("bash.exe");
  if (found === undefined) return undefined;
  if (found.toLowerCase().startsWith(systemRoot().toLowerCase())) return undefined;
  return found;
}

const PWSH_ARGS = ["-NoProfile", "-NonInteractive", "-Command"] as const;
const POWERSHELL_ARGS = PWSH_ARGS;
const BASH_ARGS = ["-c"] as const;
const CMD_ARGS = ["/d", "/s", "/c"] as const;

/**
 * The one interpreter this process will use, resolved once and remembered.
 *
 * Undefined is a real state, not an error: a machine with no shell at all
 * gets a shell tool that refuses with that sentence, rather than a crash at
 * registration time.
 */
let resolved: Interpreter | undefined;

export function resolveInterpreter(): Interpreter | undefined {
  resolved ??= measure();
  return resolved;
}

/**
 * What the environment block says about the shell, or undefined when there is
 * none. The block and the tool ask one module, so they cannot disagree.
 */
export function interpreterStatement(): readonly string[] | undefined {
  return resolveInterpreter()?.statement;
}

function measure(): Interpreter | undefined {
  if (process.platform === "win32") {
    const pwsh = scanPath("pwsh.exe");
    if (pwsh !== undefined) {
      return {
        path: pwsh,
        label: "pwsh",
        kind: "pwsh",
        args: PWSH_ARGS,
        statement: [
          "Commands run through PowerShell 7 (pwsh). Pipes, &&, quotes, and",
          "redirection are interpreted by the shell.",
        ],
      };
    }

    const bash = bashFromGit() ?? bashFromPath();
    if (bash !== undefined) {
      return {
        path: bash,
        label: "bash",
        kind: "bash",
        args: BASH_ARGS,
        statement: [
          "Commands run through bash. Pipes, &&, quotes, and redirection are",
          "interpreted by the shell.",
        ],
      };
    }

    const powershell =
      scanPath("powershell.exe") ??
      join(systemRoot(), "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    if (isFile(powershell)) {
      return {
        path: powershell,
        label: "powershell",
        kind: "powershell",
        args: POWERSHELL_ARGS,
        statement: [
          "Commands run through Windows PowerShell 5.1. Pipes, quotes, and",
          "redirection are interpreted, but && is not supported: separate",
          "commands with ; or run them one per call.",
        ],
      };
    }

    const cmd = join(systemRoot(), "System32", "cmd.exe");
    if (isFile(cmd)) {
      return {
        path: cmd,
        label: "cmd",
        kind: "cmd",
        args: CMD_ARGS,
        statement: [
          "Commands run through cmd.exe. Pipes, &&, double quotes, and",
          "redirection are interpreted by the shell.",
        ],
      };
    }

    return undefined;
  }

  for (const [path, label] of [
    ["/bin/bash", "bash"],
    ["/bin/sh", "sh"],
  ] as const) {
    if (isFile(path)) {
      return {
        path,
        label,
        kind: label === "bash" ? "bash" : "sh",
        args: BASH_ARGS,
        statement: [
          `Commands run through ${label}. Pipes, &&, quotes, and redirection`,
          "are interpreted by the shell.",
        ],
      };
    }
  }
  return undefined;
}
