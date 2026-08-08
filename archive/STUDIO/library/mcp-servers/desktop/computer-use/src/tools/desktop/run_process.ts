import { spawn } from "child_process";

export const DEFAULT_MAX_OUTPUT_CHARS = 50_000;
// Absolute ceiling even when max_output_chars is explicitly raised.
// Prevents memory exhaustion from runaway commands. ~500 KB of text.
export const ABSOLUTE_MAX_OUTPUT_CHARS = 500_000;
// Stall threshold is computed per-call as a fraction of the configured timeout
// (see runProcess). These constants bound the computed value so it's never too
// aggressive on short timeouts (PowerShell startup ~1s) or too lenient on long ones.
const STALL_MS_MIN = 10_000;  // never kill before 10s of silence (allows PS startup)
const STALL_MS_MAX = 90_000;  // never wait more than 90s regardless of timeout

// Detect when a process is blocked waiting for interactive input.
// These patterns match the most common prompts from package managers, git, sudo, etc.
const PROMPT_PATTERNS =
  /(\(y\/n\)|\[Y\/n\]|\[y\/N\]|Press any key to continue|Press Enter to continue|Password:\s*$|Enter passphrase|password for .+:|sudo:\s|Are you sure you want to|Do you want to continue|Overwrite\?|confirm\?|\[confirm\])/i;

function truncate(
  text: string,
  label: string,
  maxChars: number
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text:
      text.slice(0, maxChars) +
      `\n\n[${label} truncated — ${text.length.toLocaleString()} chars total, first ` +
      `${maxChars.toLocaleString()} shown. To get more output, pass max_output_chars up to ${ABSOLUTE_MAX_OUTPUT_CHARS.toLocaleString()}, ` +
      `or redirect output to a file: command > /tmp/out.txt, then read_file(/tmp/out.txt).]`,
    truncated: true,
  };
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
    let stdout = "";
    let stderr = "";
    let lastOutputAt = Date.now();
    let done = false;

    const proc = spawn(executable, shellArgs, {
      cwd: options.cwd,
      stdio: "pipe",
      env: options.env ?? { ...process.env },
    });

    function finish(result: RunProcessResult) {
      if (done) return;
      done = true;
      clearTimeout(timeoutTimer);
      clearInterval(stallTimer);
      resolve(result);
    }

    function buildResult(exitCode: number, extra?: Partial<RunProcessResult>): RunProcessResult {
      const o = truncate(stdout, "stdout", maxChars);
      const e = truncate(stderr, "stderr", maxChars);
      return {
        stdout: o.text,
        stderr: e.text,
        exit_code: exitCode,
        ...(o.truncated && { stdout_truncated: true }),
        ...(e.truncated && { stderr_truncated: true }),
        ...extra,
      };
    }

    function onData(chunk: Buffer, target: "stdout" | "stderr") {
      const text = chunk.toString();
      lastOutputAt = Date.now();
      if (target === "stdout") stdout += text;
      else stderr += text;

      if (PROMPT_PATTERNS.test(text)) {
        proc.kill();
        finish(
          buildResult(-1, {
            error:
              `Process is waiting for interactive input. Detected: "${text.trim().slice(0, 120)}". ` +
              `Use non-interactive flags (--yes, -y, --no-input, DEBIAN_FRONTEND=noninteractive, etc.).`,
            prompt_detected: true,
          })
        );
      }
    }

    proc.stdout?.on("data", (d: Buffer) => onData(d, "stdout"));
    proc.stderr?.on("data", (d: Buffer) => onData(d, "stderr"));

    const timeoutTimer = setTimeout(() => {
      proc.kill();
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

    const stallTimer = setInterval(() => {
      if (done) { clearInterval(stallTimer); return; }
      if (Date.now() - lastOutputAt > stallMs) {
        proc.kill();
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
    }, 5_000);

    proc.on("close", (code) => {
      finish(buildResult(code ?? 0));
    });

    proc.on("error", (err) => {
      finish(buildResult(-1, { error: err.message }));
    });
  });
}
