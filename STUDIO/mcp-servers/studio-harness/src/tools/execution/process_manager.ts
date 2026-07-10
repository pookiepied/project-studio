import { spawn, ChildProcess, spawnSync } from "child_process";
import { randomUUID } from "crypto";
import { resolveShell } from "./shell.js";

/**
 * Managed background processes
 * ============================
 * `bash` runs a command to completion and blocks until it exits — correct for
 * builds, installs, and tests, but useless for long-lived processes (dev
 * servers, file watchers, `tail -f`). This module keeps such processes alive
 * across tool calls so the agent can start one, page its output incrementally,
 * feed it input, and stop it — without ever blocking the session.
 *
 * State lives in-memory for the lifetime of the MCP server process. Every
 * managed child is killed when the server exits (see the exit hooks at the
 * bottom) so we never leak orphaned dev servers.
 */

/** Per-stream cap. Output beyond this is dropped from the front (ring buffer). */
const MAX_STREAM_CHARS = 2_000_000; // ~2 MB per stream
/** Hard ceiling on concurrently managed processes. */
const MAX_PROCESSES = 32;
/** Default page size for read_process_output. */
const DEFAULT_READ_LIMIT = 20_000;
const MAX_READ_LIMIT = 200_000;

type ProcStatus = "running" | "exited" | "killed";

interface StreamBuffer {
  /** Retained tail of the stream. */
  text: string;
  /** Absolute char offset of `text[0]` within the full stream (grows as we drop). */
  base: number;
  /** Total chars ever produced (base + text.length). */
  total: number;
}

interface ManagedProcess {
  id: string;
  command: string;
  cwd: string;
  pid: number | undefined;
  startedAt: number;
  proc: ChildProcess;
  stdout: StreamBuffer;
  stderr: StreamBuffer;
  status: ProcStatus;
  exitCode: number | null;
  signal: string | null;
  exitedAt: number | null;
}

const processes = new Map<string, ManagedProcess>();

function newStream(): StreamBuffer {
  return { text: "", base: 0, total: 0 };
}

function append(buf: StreamBuffer, chunk: string): void {
  buf.text += chunk;
  buf.total += chunk.length;
  if (buf.text.length > MAX_STREAM_CHARS) {
    const drop = buf.text.length - MAX_STREAM_CHARS;
    buf.text = buf.text.slice(drop);
    buf.base += drop;
  }
}

/** Read a bounded slice of a stream starting at absolute `offset`. */
function readStream(
  buf: StreamBuffer,
  offset: number,
  limit: number
): { chunk: string; next_offset: number; total: number; dropped_before: number; eof_offset: number } {
  const from = Math.max(offset, buf.base);
  const start = from - buf.base;
  const chunk = start >= buf.text.length ? "" : buf.text.slice(start, start + limit);
  return {
    chunk,
    next_offset: from + chunk.length,
    total: buf.total,
    // How many chars before `offset` are no longer retrievable (ring-buffer drop).
    dropped_before: Math.max(0, buf.base - offset),
    eof_offset: buf.total,
  };
}

function summarize(p: ManagedProcess): Record<string, unknown> {
  return {
    process_id: p.id,
    command: p.command,
    cwd: p.cwd,
    pid: p.pid,
    status: p.status,
    exit_code: p.exitCode,
    signal: p.signal,
    uptime_ms: (p.exitedAt ?? Date.now()) - p.startedAt,
    stdout_chars: p.stdout.total,
    stderr_chars: p.stderr.total,
  };
}

// ---------------------------------------------------------------------------
// start_process
// ---------------------------------------------------------------------------

export async function startProcess(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const command = args.command as string;
  if (!command || typeof command !== "string") {
    return { error: "start_process: 'command' (string) is required." };
  }
  if (processes.size >= MAX_PROCESSES) {
    return {
      error:
        `start_process: too many managed processes (${processes.size}/${MAX_PROCESSES}). ` +
        `Stop finished ones with stop_process, or check list_processes.`,
    };
  }

  const cwd = (args.cwd as string) || process.cwd();
  const extraEnv = (args.env as Record<string, string> | undefined) ?? undefined;

  const resolved = resolveShell();
  if ("error" in resolved) return { error: resolved.error };

  let child: ChildProcess;
  try {
    child = spawn(resolved.shell, resolved.argsFor(command), {
      cwd,
      stdio: "pipe",
      env: extraEnv ? { ...process.env, ...extraEnv } : { ...process.env },
      // Detach into its own group on POSIX so we can kill the whole tree.
      detached: process.platform !== "win32",
    });
  } catch (e: any) {
    return { error: `start_process: failed to spawn — ${e?.message ?? String(e)} (cwd: ${cwd}).` };
  }

  const managed: ManagedProcess = {
    id: `proc_${randomUUID().slice(0, 8)}`,
    command,
    cwd,
    pid: child.pid,
    startedAt: Date.now(),
    proc: child,
    stdout: newStream(),
    stderr: newStream(),
    status: "running",
    exitCode: null,
    signal: null,
    exitedAt: null,
  };

  child.stdout?.on("data", (d: Buffer) => append(managed.stdout, d.toString()));
  child.stderr?.on("data", (d: Buffer) => append(managed.stderr, d.toString()));
  child.on("error", (err) => {
    append(managed.stderr, `\n[process error] ${err.message}\n`);
  });
  child.on("close", (code, signal) => {
    managed.status = signal ? "killed" : "exited";
    managed.exitCode = code;
    managed.signal = signal;
    managed.exitedAt = Date.now();
  });

  processes.set(managed.id, managed);

  // Give a spawn failure (e.g. ENOENT) a tick to surface before we report.
  await new Promise((r) => setTimeout(r, 50));

  return {
    ...summarize(managed),
    note:
      "Process started in the background. Use read_process_output to page its stdout/stderr, " +
      "write_process_input to send stdin, and stop_process when done.",
  };
}

// ---------------------------------------------------------------------------
// read_process_output
// ---------------------------------------------------------------------------

export async function readProcessOutput(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const id = args.process_id as string;
  const managed = processes.get(id);
  if (!managed) {
    return { error: `read_process_output: no managed process '${id}'. Use list_processes to see active ids.` };
  }
  const stream = (args.stream as string) ?? "stdout";
  if (stream !== "stdout" && stream !== "stderr") {
    return { error: "read_process_output: 'stream' must be 'stdout' or 'stderr'." };
  }
  const offset = Math.max(0, (args.offset as number) ?? 0);
  const limit = Math.min(Math.max(1, (args.limit as number) ?? DEFAULT_READ_LIMIT), MAX_READ_LIMIT);

  const buf = stream === "stdout" ? managed.stdout : managed.stderr;
  const r = readStream(buf, offset, limit);

  return {
    process_id: id,
    stream,
    status: managed.status,
    exit_code: managed.exitCode,
    content: r.chunk,
    offset,
    next_offset: r.next_offset,
    total_chars: r.total,
    has_more: r.next_offset < r.total,
    ...(r.dropped_before > 0 && {
      dropped_before: r.dropped_before,
      truncated_note: `${r.dropped_before} earlier chars were dropped (ring buffer holds the most recent ${MAX_STREAM_CHARS}). Read with a higher offset.`,
    }),
  };
}

// ---------------------------------------------------------------------------
// write_process_input
// ---------------------------------------------------------------------------

export async function writeProcessInput(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const id = args.process_id as string;
  const managed = processes.get(id);
  if (!managed) {
    return { error: `write_process_input: no managed process '${id}'. Use list_processes to see active ids.` };
  }
  if (managed.status !== "running") {
    return { error: `write_process_input: process '${id}' is ${managed.status}; cannot write to its stdin.` };
  }
  if (typeof args.input !== "string") {
    return { error: "write_process_input: 'input' (string) is required." };
  }
  const input = args.input as string;
  const appendNewline = args.append_newline !== false; // default true
  const payload = appendNewline && !input.endsWith("\n") ? input + "\n" : input;

  const stdin = managed.proc.stdin;
  if (!stdin || stdin.destroyed) {
    return { error: `write_process_input: stdin for '${id}' is not writable.` };
  }
  try {
    stdin.write(payload);
  } catch (e: any) {
    return { error: `write_process_input: failed to write — ${e?.message ?? String(e)}.` };
  }
  return { process_id: id, bytes_written: Buffer.byteLength(payload, "utf-8"), status: managed.status };
}

// ---------------------------------------------------------------------------
// stop_process
// ---------------------------------------------------------------------------

function killTree(managed: ManagedProcess, signal: NodeJS.Signals): void {
  const pid = managed.pid;
  if (pid == null) return;
  try {
    if (process.platform === "win32") {
      // Kill the whole tree; Git Bash spawns children that outlive a bare kill.
      spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      // Negative pid → the detached process group.
      try { process.kill(-pid, signal); } catch { managed.proc.kill(signal); }
    }
  } catch {
    try { managed.proc.kill(signal); } catch { /* already gone */ }
  }
}

export async function stopProcess(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const id = args.process_id as string;
  const managed = processes.get(id);
  if (!managed) {
    return { error: `stop_process: no managed process '${id}'. Use list_processes to see active ids.` };
  }
  const remove = args.remove !== false; // default: drop from the table after stopping

  if (managed.status === "running") {
    const signal = (args.signal as NodeJS.Signals) || "SIGTERM";
    killTree(managed, signal);
    // Brief grace period, then force-kill if still alive.
    await new Promise((r) => setTimeout(r, 300));
    if (managed.status === "running") killTree(managed, "SIGKILL");
    await new Promise((r) => setTimeout(r, 100));
  }

  const result = { ...summarize(managed), stopped: true };
  if (remove) processes.delete(id);
  return result;
}

// ---------------------------------------------------------------------------
// list_processes
// ---------------------------------------------------------------------------

export async function listProcesses(
  _args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  return {
    count: processes.size,
    processes: [...processes.values()].map(summarize),
  };
}

// ---------------------------------------------------------------------------
// command_exists
// ---------------------------------------------------------------------------

export async function commandExists(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const name = args.command as string;
  if (!name || typeof name !== "string") {
    return { error: "command_exists: 'command' (string) is required." };
  }
  // Reject shell metacharacters — this resolves a single executable, not a command line.
  if (/[;&|<>$`\n]/.test(name)) {
    return { error: "command_exists: 'command' must be a bare executable name, not a shell expression." };
  }

  const finder = process.platform === "win32"
    ? { cmd: "where", args: [name] }
    : { cmd: "command", args: ["-v", name] };

  // `command -v` is a shell builtin; run it through the shell. `where` is a real exe.
  let located: string | null = null;
  if (process.platform === "win32") {
    const r = spawnSync(finder.cmd, finder.args, { encoding: "utf-8" });
    if (r.status === 0 && r.stdout.trim()) located = r.stdout.trim().split(/\r?\n/)[0];
  } else {
    const r = spawnSync("/bin/sh", ["-c", `command -v ${name}`], { encoding: "utf-8" });
    if (r.status === 0 && r.stdout.trim()) located = r.stdout.trim().split(/\r?\n/)[0];
  }

  if (!located) {
    return { command: name, exists: false };
  }

  // Best-effort version probe. Never fatal — many tools lack --version.
  let version: string | undefined;
  if (args.probe_version !== false) {
    const v = spawnSync(located, ["--version"], { encoding: "utf-8", timeout: 5000 });
    const out = `${v.stdout ?? ""}${v.stderr ?? ""}`.trim();
    if (out) version = out.split(/\r?\n/)[0].slice(0, 200);
  }

  return { command: name, exists: true, path: located, ...(version && { version }) };
}

// ---------------------------------------------------------------------------
// Cleanup — never leak managed children when the server shuts down.
// ---------------------------------------------------------------------------

function killAll(): void {
  for (const managed of processes.values()) {
    if (managed.status === "running") killTree(managed, "SIGKILL");
  }
}
process.once("exit", killAll);
process.once("SIGINT", () => { killAll(); process.exit(130); });
process.once("SIGTERM", () => { killAll(); process.exit(143); });
