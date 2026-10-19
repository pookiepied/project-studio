import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { platform, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { createStudioUuid } from "../contracts/uuid.js";

import driverSource from "./driver.ps1?raw";
import activitySource from "./activity.cs?raw";
import { ComputerError } from "./errors.js";
import { windowsPowerShell } from "./resolve.js";
import { InputUpdates } from "./input.js";
import type { ToolAnswer } from "./tools.js";

/**
 * One desktop driver, and the reasons it is allowed to exist.
 *
 * The browser's four states (ADR 0049 §4), kept apart here for the same
 * reason: enabled costs nothing, announced costs a sentence, loaded costs
 * the schemas - and *running* costs a PowerShell process, so nothing here
 * starts one until a tool is actually called. `request()` is the only door.
 *
 * **An idle driver closes itself**, a few minutes after the last call, and
 * the next call starts another. The model is never told; a tool that works
 * either way has nothing to report.
 *
 * **What the driver is.** Windows PowerShell 5.1 running `driver.ps1`, which
 * speaks to user32, System.Drawing and UI Automation directly (ADR 0055).
 * Nothing is installed and nothing is downloaded: the script travels inside
 * this bundle as a string and is written to a temp file at first use, because
 * a command line will not carry a script of its size. Refs handed out by
 * `read_ui` live in the driver's memory, which is why one driver serves one
 * conversation and never two.
 */

/** How long a driver may sit unused before it closes itself. */
const IDLE_MS = 5 * 60 * 1000;

/** How long one request may take before the driver is presumed wedged. */
const REQUEST_MS = 60 * 1000;

/** How long the driver has to say "ready" after it is spawned. */
const READY_MS = 30 * 1000;

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly input: InputUpdates | undefined;
}

/**
 * Where the script is written, once per script version.
 *
 * Under the temp directory rather than Studio's data root, because it is a
 * cache of something the bundle already holds and losing it costs one write.
 * The hash in the name means an upgraded Studio never runs a stale copy left
 * by an older one.
 */
function driverPath(): string {
  const hash = createHash("sha256").update(driverSource).update(activitySource).digest("hex").slice(0, 16);
  const directory = join(tmpdir(), "studio-computer", hash);
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `driver-${hash}.ps1`);
  // Written every time rather than checked: a partial file from an
  // interrupted earlier write would otherwise be trusted by its name.
  writeFileSync(join(directory, "activity.cs"), activitySource, "utf8");
  writeFileSync(path, driverSource, "utf8");
  return path;
}

/**
 * Why the desktop cannot be driven here, said for the model and the person.
 *
 * The same two-reader shape as the browser's refusal: the model needs to
 * know not to retry and what to relay; the person needs to know what would
 * change the answer.
 */
export function unsupportedMessage(): string {
  const os = platform();
  const name = os === "darwin" ? "macOS" : os === "linux" ? "Linux" : os;
  return [
    `Computer use is not available on ${name}, so the computer tools cannot run.`,
    "",
    "This is not something to retry or work around in this conversation: every computer tool",
    "will fail the same way on this machine. Tell the person what follows, then carry on",
    "without the desktop.",
    "",
    "In this version Studio drives the desktop through what Windows already has - user32,",
    "System.Drawing and UI Automation under Windows PowerShell - and ships no driver for",
    `${name}. Nothing to install would change that; it is a Studio limitation, recorded in`,
    "ADR 0055, and the browser tools remain available for anything a web page can reach.",
  ].join("\n");
}

export class ComputerSession {
  #child: ChildProcessWithoutNullStreams | undefined;
  #ready: Promise<void> | undefined;
  #closing: Promise<void> | undefined;
  readonly #pending = new Map<number, Pending>();
  #next = 1;
  #idle: NodeJS.Timeout | undefined;
  #lastFrame: { display: number; width: number; height: number } | undefined;
  #toolTail: Promise<void> = Promise.resolve();
  #interactionEpoch = 0;
  readonly #toolContext = new AsyncLocalStorage<{ epoch: number; input: InputUpdates }>();

  /** @param key Which conversation this driver belongs to. */
  constructor(readonly key: string) {}

  /** Keep an action and its observation together; stop/failure cancels queued input. */
  run<T>(operation: () => Promise<T>): Promise<T> {
    const epoch = this.#interactionEpoch;
    const result = this.#toolTail.then(async () => {
      if (epoch !== this.#interactionEpoch) throw new ComputerError("refused", { message: "Computer state changed while this call was queued. Observe status before sending new input." });
      try {
        return await this.#toolContext.run({ epoch, input: new InputUpdates() }, operation);
      } catch (error) {
        this.#interactionEpoch++;
        throw error;
      }
    });
    this.#toolTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async runTool(operation: () => Promise<ToolAnswer>): Promise<ToolAnswer> {
    let updates: InputUpdates | undefined;
    try {
      return await this.run(async () => {
        updates = this.#toolContext.getStore()?.input;
        const result = await operation();
        return updates?.decorate(result) ?? result;
      });
    } catch (error) {
      if (updates === undefined || !updates.hasUpdates) throw error;
      return updates.decorate({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Computer input failed." }] });
    }
  }

  get running(): boolean {
    return this.#child !== undefined;
  }

  get releasing(): boolean { return this.#closing !== undefined; }

  /** The frame of the last screenshot, so an acting result can name it. */
  get lastFrame(): { display: number; width: number; height: number } | undefined {
    return this.#lastFrame;
  }

  rememberFrame(frame: { display: number; width: number; height: number }): void {
    this.#lastFrame = frame;
  }

  /**
   * Starts the driver, or says plainly why it cannot.
   *
   * Windows only in this version, and the refusal is written before any
   * process is spawned, because a PowerShell that is not there produces an
   * ENOENT nobody can act on.
   */
  async #launch(): Promise<ChildProcessWithoutNullStreams> {
    const existing = this.#child;
    if (existing !== undefined) {
      await this.#ready;
      return existing;
    }
    if (platform() !== "win32") {
      throw new ComputerError("unsupported", { message: unsupportedMessage() });
    }

    // The absolute path, because this process was given no PATH (see
    // `windowsPowerShell`), and `windowsHide` because a console window
    // flashing up over the person's work is exactly what a driver must not do.
    const child = spawn(
      windowsPowerShell(),
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", driverPath()],
      { stdio: "pipe", windowsHide: true },
    );
    this.#child = child;
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = `${stderr}${chunk.toString("utf8")}`.slice(-4000);
    });

    this.#ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new ComputerError("driver", {
          message: `The desktop driver did not start within ${String(READY_MS / 1000)} seconds.${stderr === "" ? "" : ` It said: ${stderr.trim()}`}`,
        }));
        this.#forget();
      }, READY_MS);
      const lines = createInterface({ input: child.stdout });
      lines.on("line", (line) => {
        const trimmed = line.trim();
        if (trimmed === "") return;
        let message: unknown;
        try {
          message = JSON.parse(trimmed);
        } catch {
          return;
        }
        if (typeof message !== "object" || message === null) return;
        const record = message as Record<string, unknown>;
        if (record["id"] === "ready") {
          clearTimeout(timer);
          resolve();
          return;
        }
        const id = typeof record["id"] === "number" ? record["id"] : undefined;
        if (id === undefined) return;
        const waiting = this.#pending.get(id);
        if (waiting === undefined) return;
        this.#pending.delete(id);
        clearTimeout(waiting.timer);
        waiting.input?.add(record["userInput"]);
        if (record["ok"] === true) waiting.resolve(record["result"]);
        else {
          const said = record["error"];
          waiting.reject(this.#classify(typeof said === "string" ? said : "The driver refused without saying why."));
        }
      });
      child.on("exit", (code) => {
        // The driver can die on its own - killed from a task manager, or a
        // fault inside a UI Automation call. Forgetting it here is what lets
        // the next call start a fresh one, and every call still waiting is
        // answered rather than left hanging.
        clearTimeout(timer);
        const reason = new ComputerError("driver", {
          message: `The desktop driver stopped (exit ${String(code)}).${stderr === "" ? "" : ` It said: ${stderr.trim()}`} The next call starts it again.`,
        });
        reject(reason);
        if (this.#child !== child) return;
        for (const waiting of this.#pending.values()) {
          clearTimeout(waiting.timer);
          waiting.reject(reason);
        }
        this.#pending.clear();
        this.#forget();
      });
      child.on("error", (error) => {
        clearTimeout(timer);
        reject(new ComputerError("driver", { message: `PowerShell could not be started: ${error.message}` }));
        if (this.#child !== child) return;
        this.#forget();
      });
    });
    // Rejections are delivered to whoever awaits `#ready`; an unobserved one
    // here would otherwise be reported as an unhandled rejection.
    this.#ready.catch(() => undefined);
    await this.#ready;
    return child;
  }

  /** The driver's refusals, sorted into the kinds a caller can act on. */
  #classify(message: string): ComputerError {
    if (/ui_|element reference|read the window again/i.test(message)) {
      return new ComputerError("no_element", { message });
    }
    if (/refused|administrator/i.test(message)) return new ComputerError("refused", { message });
    return new ComputerError("bad_input", { message });
  }

  /**
   * One operation, answered. The only door to a running driver, so also the
   * only place the idle timer is renewed.
   */
  async request(op: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const context = this.#toolContext.getStore();
    const epoch = context?.epoch;
    if (this.#closing !== undefined) await this.#closing;
    if (epoch !== undefined && epoch !== this.#interactionEpoch) throw new ComputerError("refused", { message: "Computer control was stopped or replaced. Observe status before continuing." });
    const child = await this.#launch();
    if (epoch !== undefined && epoch !== this.#interactionEpoch) throw new ComputerError("refused", { message: "Computer control changed while the driver started. Observe status again." });
    this.#touch();
    const id = this.#next++;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new ComputerError("driver", {
          message: `The desktop driver did not answer "${op}" within ${String(REQUEST_MS / 1000)} seconds. It has been stopped; the next call starts it again.`,
        }));
        void this.close();
      }, REQUEST_MS);
      this.#pending.set(id, { resolve, reject, timer, input: context?.input });
      child.stdin.write(`${JSON.stringify({ id, op, args: { ...args, observationId: createStudioUuid() } })}\n`);
    });
  }

  /** Ends the driver now. Safe when nothing is running. */
  async close(): Promise<void> {
    const child = this.#child;
    this.#forget();
    for (const waiting of this.#pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new ComputerError("refused", { message: "Computer control stopped before this call's outcome was observed. Reobserve before further input; do not replay it automatically." }));
    }
    this.#pending.clear();
    if (this.#closing !== undefined) return this.#closing;
    if (child === undefined) return;
    const closing = new Promise<void>((resolve) => {
      const done = (): void => {
        clearTimeout(force);
        resolve();
      };
      const force = setTimeout(() => {
        child.kill();
        resolve();
      }, 2000);
      child.once("exit", done);
      // Closing stdin is the driver's signal to leave its loop; a kill is
      // only for one that does not.
      child.stdin.end();
    });
    this.#closing = closing;
    try { await closing; } finally { if (this.#closing === closing) this.#closing = undefined; }
  }

  #forget(): void {
    this.#interactionEpoch++;
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = undefined;
    this.#child = undefined;
    this.#ready = undefined;
    this.#lastFrame = undefined;
  }

  #touch(): void {
    if (this.#idle !== undefined) clearTimeout(this.#idle);
    this.#idle = setTimeout(() => {
      void this.close();
    }, IDLE_MS);
    // The timer must not be the reason this process stays alive.
    this.#idle.unref?.();
  }
}
