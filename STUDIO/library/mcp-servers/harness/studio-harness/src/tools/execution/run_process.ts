import { spawn, type ChildProcess } from "child_process";
import { StringDecoder } from "string_decoder";

export const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
// Absolute ceiling even when max_output_chars is explicitly raised.
// Prevents memory exhaustion from runaway commands. ~500 KB of text.
export const ABSOLUTE_MAX_OUTPUT_CHARS = 500_000;
// Stall threshold is computed per-call as a fraction of the configured timeout
// (see runProcess). These constants bound the computed value so it's never too
// aggressive on short timeouts (PowerShell startup ~1s) or too lenient on long ones.
const STALL_MS_MIN = 10_000;  // never kill before 10s of silence (allows PS startup)
const STALL_MS_MAX = 90_000;  // never wait more than 90s regardless of timeout
const MONITOR_INTERVAL_MS = 1_000;
// A prompt only counts as a real interactive block once output has gone quiet for
// this long. A build that merely prints "Password:" in passing keeps producing
// output, so its idle timer never trips and it is never falsely killed.
const PROMPT_IDLE_MS = 1_500;
// Prompt patterns are matched against only the trailing window of the stream, so a
// prompt that later scrolls out of view (more output arrived) stops being a candidate.
const PROMPT_TAIL_CHARS = 400;

// Detect when a process is blocked waiting for interactive input.
// These patterns match the most common prompts from package managers, git, sudo, etc.
const PROMPT_PATTERNS =
  /(\(y\/n\)|\[Y\/n\]|\[y\/N\]|Press any key to continue|Press Enter to continue|Password:\s*$|Enter passphrase|password for .+:|sudo:\s|Are you sure you want to|Do you want to continue|Overwrite\?|confirm\?|\[confirm\])/i;

/**
 * Force-terminate a process and its ENTIRE child tree.
 *
 * A bare `proc.kill()` only signals the direct child. When the child is a shell
 * (`bash -c "npm run build"`), the real workload (node/tsc/python) is a
 * grandchild that is orphaned and keeps running — holding the cwd and burning
 * CPU. On Windows we use `taskkill /T /F`; on POSIX the child is spawned as its
 * own process-group leader (`detached`) so we can signal the whole group.
 */
export function killTree(proc: ChildProcess): void {
  const pid = proc.pid;
  if (pid == null) {
    try { proc.kill(); } catch { /* already gone */ }
    return;
  }
  if (process.platform === "win32") {
    try {
      const killer = spawn("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      killer.on("error", () => { try { proc.kill(); } catch { /* already gone */ } });
    } catch {
      try { proc.kill(); } catch { /* already gone */ }
    }
  } else {
    try {
      process.kill(-pid, "SIGKILL"); // negative pid → the whole process group
    } catch {
      try { proc.kill("SIGKILL"); } catch { /* already gone */ }
    }
  }
}

interface Sink {
  /** Retained head of the stream, capped at ABSOLUTE_MAX_OUTPUT_CHARS. */
  head: string;
  /** True total chars seen (may exceed head length). */
  total: number;
  /** Rolling last-N chars, used only for interactive-prompt detection. */
  tail: string;
}

function makeSink(): Sink {
  return { head: "", total: 0, tail: "" };
}

/** Append decoded text to a sink, keeping the retained head bounded. */
function push(sink: Sink, text: string): void {
  if (!text) return;
  sink.total += text.length;
  const room = ABSOLUTE_MAX_OUTPUT_CHARS - sink.head.length;
  if (room > 0) sink.head += text.length <= room ? text : text.slice(0, room);
  sink.tail = (sink.tail + text).slice(-PROMPT_TAIL_CHARS);
}

/** Finalize a sink to a display string truncated at maxChars, with an accurate total. */
function finalize(
  sink: Sink,
  label: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (sink.total <= maxChars) return { text: sink.head, truncated: false };
  return {
    text:
      sink.head.slice(0, maxChars) +
      `\n\n[${label} truncated — ${sink.total.toLocaleString()} chars total, first ` +
      `${maxChars.toLocaleString()} shown. To get more output, pass max_output_chars up to ${ABSOLUTE_MAX_OUTPUT_CHARS.toLocaleString()}, ` +
      `or redirect output to a file: command > /tmp/out.txt, then read_file(/tmp/out.txt).]`,
    truncated: true,
  };
}

/** Return the matched prompt snippet from a trailing window, or null. */
function pickPrompt(tail: string): string | null {
  const m = tail.match(PROMPT_PATTERNS);
  if (!m) return null;
  return tail.slice(Math.max(0, (m.index ?? 0) - 40)).trim().slice(0, 160);
}

export interface RunProcessResult extends Record<string, unknown> {
  stdout: string;
  stderr: string;
  exit_code: number;
  error?: string;
  stdout_truncated?: boolean;
  stderr_truncated?: boolean;
  prompt_detected?: boolean;
  stalled?: boolean;
}

export async function runProcess(
  executable: string,
  shellArgs: string[],
  options: { cwd: string; timeout: number; env?: NodeJS.ProcessEnv; maxOutputChars?: number }
): Promise<RunProcessResult> {
  const maxChars = Math.min(
    (options.maxOutputChars != null && options.maxOutputChars > 0)
      ? options.maxOutputChars
      : DEFAULT_MAX_OUTPUT_CHARS,
    ABSOLUTE_MAX_OUTPUT_CHARS
  );
  // Stall threshold: half the configured timeout, capped at 90 s.
  // This way a long build (timeout=300s) won't get killed after 45s of silence
  // during a quiet linking or compilation phase.
  // Floor at STALL_MS_MIN so short timeouts (FAST_QUERY=20s) don't kill PowerShell before startup.
  const stallMs = Math.min(Math.max(Math.floor(options.timeout * 0.5), STALL_MS_MIN), STALL_MS_MAX);
  return new Promise((resolve) => {
    const outSink = makeSink();
    const errSink = makeSink();
    // StringDecoder correctly reassembles multibyte UTF-8 sequences split across
    // chunk boundaries (raw Buffer.toString() would emit replacement chars).
    const outDec = new StringDecoder("utf8");
    const errDec = new StringDecoder("utf8");
    let lastOutputAt = Date.now();
    let promptText: string | null = null;
    let done = false;

    const proc = spawn(executable, shellArgs, {
      cwd: options.cwd,
      stdio: "pipe",
      env: options.env ?? { ...process.env },
      // POSIX: become a process-group leader so killTree can signal the group.
      // Windows uses taskkill /T instead, so detached (which would open a new
      // console window) is left off there.
      detached: process.platform !== "win32",
    });

    function finish(result: RunProcessResult) {
      if (done) return;
      done = true;
      clearTimeout(timeoutTimer);
      clearInterval(monitorTimer);
      resolve(result);
    }

    function buildResult(exitCode: number, extra?: Partial<RunProcessResult>): RunProcessResult {
      const o = finalize(outSink, "stdout", maxChars);
      const e = finalize(errSink, "stderr", maxChars);
      return {
        stdout: o.text,
        stderr: e.text,
        exit_code: exitCode,
        ...(o.truncated && { stdout_truncated: true }),
        ...(e.truncated && { stderr_truncated: true }),
        ...extra,
      };
    }

    function onData(text: string, target: "stdout" | "stderr") {
      if (!text) return;
      lastOutputAt = Date.now();
      push(target === "stdout" ? outSink : errSink, text);
      // Recompute prompt candidacy from the current trailing windows. This
      // naturally clears when fresh non-prompt output scrolls the prompt away.
      promptText = pickPrompt(outSink.tail) ?? pickPrompt(errSink.tail);
    }

    proc.stdout?.on("data", (d: Buffer) => onData(outDec.write(d), "stdout"));
    proc.stderr?.on("data", (d: Buffer) => onData(errDec.write(d), "stderr"));

    const timeoutTimer = setTimeout(() => {
      killTree(proc);
      finish(
        buildResult(-1, {
          error:
            `Command timed out after ${options.timeout}ms. ` +
            `Retry with a higher timeout. Suggested values: ` +
            `npm/yarn install → 180000, pip install → 120000, ` +
            `cargo build → 300000, large test suites → 300000, ` +
            `docker build → 600000. ` +
            `Alternatively, split into smaller commands or redirect output to a file ` +
            `(command > out.txt) and tail it.`,
        })
      );
    }, options.timeout);

    const monitorTimer = setInterval(() => {
      if (done) return;
      const idle = Date.now() - lastOutputAt;
      // A prompt is only a real block once the process has also gone quiet.
      if (promptText && idle > PROMPT_IDLE_MS) {
        killTree(proc);
        finish(
          buildResult(-1, {
            error:
              `Process is waiting for interactive input. Detected: "${promptText}". ` +
              `Use non-interactive flags (--yes, -y, --no-input, DEBIAN_FRONTEND=noninteractive, etc.).`,
            prompt_detected: true,
          })
        );
        return;
      }
      if (idle > stallMs) {
        killTree(proc);
        finish(
          buildResult(-1, {
            error:
              `Process stalled — no output for ${stallMs / 1000}s. Common causes: ` +
              `(1) waiting for interactive input — add non-interactive flags ` +
              `(--yes, -y, --no-input, DEBIAN_FRONTEND=noninteractive, etc.); ` +
              `(2) a slow phase that produces no output (e.g. linker, large download) — ` +
              `retry with a higher timeout and redirect output to a file so progress is captured. ` +
              `Partial output returned.`,
            stalled: true,
          })
        );
      }
    }, MONITOR_INTERVAL_MS);

    proc.on("close", (code) => {
      // Flush any bytes the decoders were holding for an incomplete sequence.
      push(outSink, outDec.end());
      push(errSink, errDec.end());
      finish(buildResult(code ?? 0));
    });

    proc.on("error", (err) => {
      finish(buildResult(-1, { error: err.message }));
    });
  });
}
