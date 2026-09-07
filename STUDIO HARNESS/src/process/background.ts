import { spawn } from "node:child_process";

import { buildEnvironment } from "./environment.js";
import { killProcessTree } from "./exec.js";
import { assertRunnableCommand, type RunProcessOptions } from "./exec.js";

/**
 * Commands that outlive the call that started them.
 *
 * ---- The problem this is the answer to ------------------------------------
 *
 * `runProcess` resolves on the child's `close`, which fires when the process
 * has exited *and* every pipe it handed to a descendant has closed. That is
 * exactly right for a build or a test run and exactly wrong for a dev server,
 * which is meant never to exit. A model asked to start one and check a few
 * pages has no way to express that: the call sits until the timeout, the
 * pages are never fetched, and the output it was waiting for is discarded
 * with the rejection.
 *
 * The usual workarounds do not work either, and it is worth saying why so
 * nobody spends another hour on them. Detaching with `start` on Windows
 * returns immediately from `start` itself but the grandchild inherits the
 * same stdout and stderr pipes, so `close` still waits for a process that
 * will never exit. Redirecting the inner command's output inside the line
 * helps only if every descendant cooperates. Neither is something a model
 * should have to know, and one of them is the "pipe hang" already documented
 * in the environment block.
 *
 * So the mechanism is explicit instead: a job is started, its id comes back
 * at once, and its output is read later.
 *
 * ---- Why the output is a ring buffer and not a file ------------------------
 *
 * A dev server left running for an hour writes more than anyone will read,
 * and almost all of it is scrollback nobody wants. What is wanted is the last
 * screenful - the line that says which port it bound, or the stack trace it
 * died on. So the buffer keeps a bounded tail and counts what it dropped,
 * which is the one fact a tail cannot convey on its own.
 *
 * Nothing is written to disk. A log file inside the project would be a file
 * the agent left in somebody's repository, and one in the scratch directory
 * would be a second place to look for the same bytes.
 *
 * ---- Lifetime --------------------------------------------------------------
 *
 * A job belongs to the conversation that started it and outlives the turn -
 * that is the entire point. It does not outlive the harness: `stopAll` runs
 * on shutdown, because a dev server still holding port 3000 after Studio has
 * closed is a process the person did not start and cannot see.
 */

/** The last lines of a job's output, and how much was thrown away. */
const MAX_KEPT_LINES = 400;

/** A hard ceiling on one job's buffered bytes, before lines are dropped. */
const MAX_KEPT_BYTES = 256 * 1024;

export type JobState = "running" | "exited" | "stopped" | "failed";

export interface JobStatus {
  readonly id: string;
  readonly command: string;
  readonly state: JobState;
  /** Present once it has ended. Null while it runs. */
  readonly exitCode: number | null;
  readonly startedAt: number;
  /** The tail of stdout and stderr, interleaved as they arrived. */
  readonly output: string;
  /** Lines dropped off the front of the tail, or zero. */
  readonly dropped: number;
  /** Why it failed to start, when it did. */
  readonly error?: string;
}

interface Job {
  readonly id: string;
  readonly command: string;
  readonly conversationId: string;
  readonly startedAt: number;
  readonly lines: string[];
  dropped: number;
  bytes: number;
  /** Whatever is left of a line that arrived without its newline yet. */
  partial: string;
  state: JobState;
  exitCode: number | null;
  error?: string;
  pid: number | undefined;
  kill: () => void;
}

export interface StartJobOptions extends Omit<RunProcessOptions, "timeoutMs" | "signal" | "stdin"> {
  /** The line as the person would read it, for the listing. */
  readonly command: string;
  readonly conversationId: string;
}

/**
 * The jobs one harness is running, across every conversation.
 *
 * One registry rather than one per conversation, because the thing that has
 * to be true on shutdown - nothing of ours is still running - is a statement
 * about the process, not about any conversation in it. Reads are scoped by
 * conversation so one cannot see or stop another's.
 */
export class BackgroundJobs {
  readonly #jobs = new Map<string, Job>();
  #counter = 0;

  /**
   * Starts a command and returns at once.
   *
   * The child is spawned with pipes as usual - the pipes were never the
   * problem, waiting on them was - so its output can be read later. What is
   * different is that nothing here awaits `close`.
   */
  start(options: StartJobOptions): JobStatus {
    assertRunnableCommand(options.executable, options.args);

    this.#counter += 1;
    const id = `job_${this.#counter}`;
    const job: Job = {
      id,
      command: options.command,
      conversationId: options.conversationId,
      startedAt: Date.now(),
      lines: [],
      dropped: 0,
      bytes: 0,
      partial: "",
      state: "running",
      exitCode: null,
      pid: undefined,
      kill: () => {},
    };
    this.#jobs.set(id, job);

    const child = spawn(options.executable, [...options.args], {
      cwd: options.cwd,
      env: buildEnvironment(options.env),
      // The same invariant every other spawn here keeps.
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });

    job.pid = child.pid;
    job.kill = () => killProcessTree(child.pid, () => child.kill("SIGKILL"));

    const take = (chunk: Buffer): void => appendOutput(job, chunk.toString("utf8"));
    child.stdout.on("data", take);
    child.stderr.on("data", take);

    child.on("error", (cause: Error) => {
      job.state = "failed";
      job.error = cause.message;
    });

    child.on("close", (code) => {
      flushPartial(job);
      // A stop already recorded its own state; a close arriving afterwards is
      // the confirmation of it, not a new outcome.
      if (job.state === "running") {
        job.state = "exited";
        job.exitCode = code ?? 1;
      }
    });

    return statusOf(job);
  }

  /** One job, if it belongs to the asking conversation. */
  get(conversationId: string, id: string): JobStatus | undefined {
    const job = this.#jobs.get(id);
    if (job === undefined || job.conversationId !== conversationId) return undefined;
    return statusOf(job);
  }

  /** Every job this conversation started, newest last. */
  list(conversationId: string): readonly JobStatus[] {
    return [...this.#jobs.values()]
      .filter((job) => job.conversationId === conversationId)
      .map((job) => statusOf(job));
  }

  /**
   * Stops one job. Answers whether there was one to stop.
   *
   * The whole tree, not just the process we spawned: a dev server is usually
   * a launcher plus the server that holds the port, and killing the launcher
   * alone leaves the port taken - which reads as "the port is still in use
   * after I stopped it" and is the confusing half of this feature.
   */
  stop(conversationId: string, id: string): boolean {
    const job = this.#jobs.get(id);
    if (job === undefined || job.conversationId !== conversationId) return false;
    if (job.state === "running") {
      job.state = "stopped";
      job.kill();
    }
    return true;
  }

  /** Everything, for shutdown. Nothing of ours keeps running without Studio. */
  stopAll(): void {
    for (const job of this.#jobs.values()) {
      if (job.state !== "running") continue;
      job.state = "stopped";
      job.kill();
    }
  }
}

/** Adds output, keeping the tail bounded in both lines and bytes. */
function appendOutput(job: Job, text: string): void {
  const pieces = (job.partial + text).split(/\r?\n/);
  // The last piece has no newline yet: it is the start of the next line, and
  // emitting it now would split one line of output across two.
  job.partial = pieces.pop() ?? "";
  for (const line of pieces) {
    job.lines.push(line);
    job.bytes += line.length + 1;
  }
  while (job.lines.length > MAX_KEPT_LINES || job.bytes > MAX_KEPT_BYTES) {
    const gone = job.lines.shift();
    if (gone === undefined) break;
    job.bytes -= gone.length + 1;
    job.dropped += 1;
  }
}

/** The last line, when it never got its newline because the process ended. */
function flushPartial(job: Job): void {
  if (job.partial === "") return;
  appendOutput(job, "\n");
}

function statusOf(job: Job): JobStatus {
  // The unterminated line is shown too. A server that prints its port without
  // a trailing newline, then waits, would otherwise show nothing at all -
  // which is the exact moment the output is most worth reading.
  const tail = job.partial === "" ? job.lines : [...job.lines, job.partial];
  return {
    id: job.id,
    command: job.command,
    state: job.state,
    exitCode: job.exitCode,
    startedAt: job.startedAt,
    output: tail.join("\n"),
    dropped: job.dropped,
    ...(job.error === undefined ? {} : { error: job.error }),
  };
}
