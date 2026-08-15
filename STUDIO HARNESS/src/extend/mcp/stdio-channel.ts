import { spawn, type ChildProcess } from "node:child_process";

import {
  assertRunnableCommand,
  buildEnvironment,
  killProcessTree,
} from "../../process/exec.js";
import { ExtendError } from "../errors.js";
import type { McpChannel } from "./connection.js";

/**
 * A local MCP server, running as a child process.
 *
 * The one part of the MCP client that cannot be tested without an operating
 * system, which is why it is deliberately the smallest. Everything that decides
 * anything — framing, correlation, the era probe, what happens when a server
 * dies — lives above this and is tested with a channel that has no process
 * behind it. This file starts a program and moves bytes.
 *
 * **Every rule about running a program is reused, not restated.**
 * `assertRunnableCommand` is the same check `shell` and `git` pass, so an
 * absolute path, the no-`.cmd` rule, and the argument checks cannot drift for
 * MCP alone. `killProcessTree` is the same kill, which matters more here than
 * anywhere: an MCP server is usually `node` running someone else's entry point,
 * and that entry point may start whatever it likes.
 *
 * **The environment is built from policy, never inherited.** `buildEnvironment`
 * supplies the OS plumbing a program needs to start and nothing else — no
 * `PATH`, so a server cannot find tools nobody approved, and no inherited
 * variables, so a key in the user's shell does not silently reach a
 * third-party server. What the server *is* meant to receive is passed
 * explicitly, and a secret among it comes from the credential store at this
 * moment and is never written down.
 */

export interface StdioChannelOptions {
  /** Absolute path to a real executable. */
  readonly command: string;
  readonly args: readonly string[];
  /** Where the server runs. The project root, not ours. */
  readonly cwd: string;
  /**
   * What the server receives, on top of the OS plumbing. A secret belongs here
   * and only here — read from the credential store by the caller, held for as
   * long as this call takes, and never stored.
   */
  readonly env?: Readonly<Record<string, string>>;
  /**
   * How long the program has to still be running before we believe it started.
   *
   * A server that exits immediately — a missing module, a bad argument — is the
   * most common failure by a wide margin, and without this it presents as a
   * connection that answers nothing rather than as a program that did not run.
   */
  readonly startupTimeoutMs?: number;
}

/** Five seconds. A server that has not survived this long did not start. */
const DEFAULT_STARTUP_TIMEOUT_MS = 5_000;

/**
 * How long a server gets to exit after being asked politely.
 *
 * Closing stdin is the documented way to tell an MCP server to stop, and a
 * well-behaved one flushes and exits. This is the wait before the kill, and it
 * is short: nothing here is worth a long shutdown, and a server that ignores
 * the request is exactly the one that must not be left running.
 */
const STOP_GRACE_MS = 2_000;

export class StdioChannel implements McpChannel {
  readonly #child: ChildProcess;
  #data: ((chunk: string | Uint8Array) => void) | undefined;
  #stderr: ((chunk: string | Uint8Array) => void) | undefined;
  #close: ((reason?: unknown) => void) | undefined;
  #ended = false;
  #stopTimer: ReturnType<typeof setTimeout> | undefined;
  /**
   * What arrived before anyone was listening.
   *
   * The process starts, then survives the startup window, and only then does a
   * connection attach its listeners — so everything a fast server says in that
   * gap has no reader yet. Dropping it loses precisely the output that explains
   * a bad start, and for a server that greets us immediately it loses the
   * greeting. Held here and handed over the moment a listener arrives.
   *
   * Bounded by the startup window rather than by a size: it stops filling as
   * soon as the first listener attaches, which always happens.
   */
  readonly #bufferedData: Buffer[] = [];
  readonly #bufferedStderr: Buffer[] = [];

  private constructor(child: ChildProcess) {
    this.#child = child;

    // Subscribed immediately, not when a listener is attached. A pipe nobody
    // reads fills and then blocks the process writing into it, so a server
    // that logs enough before anyone listens would hang rather than fail.
    child.stdout?.on("data", (chunk: Buffer) => {
      if (this.#data === undefined) this.#bufferedData.push(chunk);
      else this.#data(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      if (this.#stderr === undefined) this.#bufferedStderr.push(chunk);
      else this.#stderr(chunk);
    });

    child.on("exit", (code, signal) => {
      this.#finish(
        new ExtendError("disconnected", {
          message:
            signal === null
              ? `The server stopped with exit code ${String(code)}.`
              : `The server was stopped by ${signal}.`,
        }),
      );
    });

    // A spawn that fails arrives here rather than by throwing, because the
    // failure happens after `spawn` returns.
    child.on("error", (cause) => {
      this.#finish(
        new ExtendError("internal", {
          message: `The server could not be started: ${cause.message}`,
        }),
      );
    });

    // A write to a pipe whose reader is gone raises EPIPE on the stream rather
    // than at the call. Unhandled, that ends the harness rather than the
    // connection.
    child.stdin?.on("error", () => undefined);
  }

  /**
   * Starts the program and resolves once it has survived the startup window.
   *
   * Waiting is what turns "a server that exits immediately" into a start
   * failure rather than a connection that answers nothing. It costs the startup
   * window on every launch, which is paid once per server per session and buys
   * the single most common failure a usable message.
   */
  static async start(options: StdioChannelOptions): Promise<StdioChannel> {
    assertRunnableCommand(options.command, options.args);

    const child = spawn(options.command, [...options.args], {
      cwd: options.cwd,
      env: buildEnvironment(options.env),
      // The whole design rests on this staying false.
      shell: false,
      detached: process.platform !== "win32",
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });

    const channel = new StdioChannel(child);
    const window = options.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT_MS;

    await new Promise<void>((resolve, reject) => {
      const settled = { done: false };
      const finish = (error?: ExtendError): void => {
        if (settled.done) return;
        settled.done = true;
        clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };

      const timer = setTimeout(() => finish(), window);

      // An exit inside the window is a failed start, and its diagnostics are
      // the only useful thing we will ever have about it.
      child.once("exit", (code) => {
        finish(
          new ExtendError("internal", {
            message: `The server stopped immediately with exit code ${String(code)}.`,
          }),
        );
      });
      child.once("error", (cause) => {
        finish(
          new ExtendError("internal", {
            message: `The server could not be started: ${cause.message}`,
          }),
        );
      });
    });

    return channel;
  }

  send(line: string): void {
    if (this.#ended) throw new ExtendError("disconnected");
    this.#child.stdin?.write(line);
  }

  onData(listener: (chunk: string | Uint8Array) => void): void {
    this.#data = listener;
    // In order, and before anything new: a message split across the boundary
    // would otherwise be reassembled out of sequence.
    while (this.#bufferedData.length > 0) {
      listener(this.#bufferedData.shift() as Buffer);
    }
  }

  onStderr(listener: (chunk: string | Uint8Array) => void): void {
    this.#stderr = listener;
    while (this.#bufferedStderr.length > 0) {
      listener(this.#bufferedStderr.shift() as Buffer);
    }
  }

  onClose(listener: (reason?: unknown) => void): void {
    this.#close = listener;
  }

  /**
   * Asks the server to stop, then makes sure of it.
   *
   * Closing stdin first, because that is how an MCP server is told to shut
   * down and a server given no chance to flush loses whatever it was writing.
   * The kill is the guarantee, not the request, and it takes the whole tree —
   * killing only the program we named leaves whatever it started behind,
   * holding ports and file handles.
   */
  close(): void {
    if (this.#ended) return;

    this.#child.stdin?.end();

    this.#stopTimer = setTimeout(() => {
      killProcessTree(this.#child.pid, () => this.#child.kill("SIGKILL"));
    }, STOP_GRACE_MS);
    // Nothing should be held open waiting for a server we have already
    // finished with.
    this.#stopTimer.unref?.();
  }

  #finish(reason: unknown): void {
    if (this.#ended) return;
    this.#ended = true;
    if (this.#stopTimer !== undefined) clearTimeout(this.#stopTimer);
    this.#close?.(reason);
  }
}
