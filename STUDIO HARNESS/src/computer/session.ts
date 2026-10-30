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
import { ComputerError, type ComputerFailure } from "./errors.js";
import { windowsPowerShell } from "./resolve.js";
import { InputUpdates } from "./input.js";
import { checkDesktopGuard, type FrameRecord } from "./control.js";
import type { SharedObservation } from "./observations.js";

/** A picture before the server knows who took it and against which desktop state. */
export type OfferedObservation = Omit<SharedObservation, "by" | "changes">;
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

/** How long a request with no budget of its own may take before the driver is presumed wedged. */
const REQUEST_MS = 60 * 1000;

/**
 * How long each operation may take before the driver is presumed wedged.
 * Every answer that sends input also waits for the screen to settle (at
 * most 0.8 s) and reads the window state around it, so input ops budget for
 * that too. A hung click must not hold the desktop for a minute.
 */
const OP_MS: Readonly<Record<string, number>> = {
  ping: 5_000, cursor: 2_000, pulse: 2_000, sensitivity: 5_000, displays: 5_000, status: 5_000, release_held: 5_000, reset_refs: 5_000,
  move: 5_000, click: 8_000, button: 5_000, scroll: 8_000, key: 8_000, drag: 10_000,
  screenshot: 10_000, clipboard: 5_000, focus: 10_000, arrange: 10_000, windows: 10_000, apps: 15_000,
  act: 10_000, set_value: 10_000, select_text: 10_000, open: 30_000, read_ui: 30_000, observe: 30_000,
  key_toggle: 8_000, paste: 10_000, get_window: 10_000,
};

/** The budget for one request; ops whose length is in their arguments get it added. */
export function requestBudget(op: string, args: Record<string, unknown> = {}): number {
  const seconds = typeof args["seconds"] === "number" && Number.isFinite(args["seconds"]) ? Math.max(0, args["seconds"]) : undefined;
  switch (op) {
    case "wait_window": return (Math.min(seconds ?? 10, 60) + 2) * 1000;
    case "hold": return (Math.min(seconds ?? 0, 30) + 5) * 1000;
    // One key event pair per character with a short pause each.
    case "type": return 8_000 + 30 * (typeof args["text"] === "string" ? args["text"].length : 0);
    // A pause at each waypoint, on top of the moves themselves.
    case "drag": return 10_000 + (Array.isArray(args["path"]) ? args["path"].length : 0) * (1_000 + (typeof args["settle"] === "number" ? Math.min(args["settle"], 2_000) : 0));
    default: return OP_MS[op] ?? REQUEST_MS;
  }
}

/** The kinds a driver refusal may name; anything else is answered as bad input. */
const DRIVER_CODES: ReadonlySet<string> = new Set<ComputerFailure>(["bad_input", "no_element", "refused", "control"]);

/** The request id of an answer line that did not parse, when its prefix still says it. */
function tornId(line: string): number | undefined {
  const match = /^\{"id":(\d+),/.exec(line);
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** How long the driver has to say "ready" after it is spawned. */
const READY_MS = 30 * 1000;

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: NodeJS.Timeout;
  readonly deadlineAt: number;
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

/** A driver refusal, as the kind its envelope names; a refusal without a known code is bad input. */
export function classify(message: string, code: unknown): ComputerError {
  const kind = typeof code === "string" && DRIVER_CODES.has(code) ? code as ComputerFailure : "bad_input";
  return new ComputerError(kind, { message });
}

export class ComputerSession {
  #child: ChildProcessWithoutNullStreams | undefined;
  #ready: Promise<void> | undefined;
  #closing: Promise<boolean> | undefined;
  readonly #pending = new Map<number, Pending>();
  #next = 1;
  #idle: NodeJS.Timeout | undefined;
  #lastFrame: { display: number; width: number; height: number } | undefined;
  #toolTail: Promise<void> = Promise.resolve();
  #interactionEpoch = 0;
  /**
   * One failure fences the queued calls of the actor that failed, not its
   * siblings: a worker's refused click says nothing about whether the voice
   * agent's queued screenshot is still wanted. The driver ending fences all.
   */
  readonly #actorEpochs = new Map<string, number>();
  readonly #toolContext = new AsyncLocalStorage<{ epoch: number; input: InputUpdates }>();
  #onStop: (() => void) | undefined;

  /**
   * Called as soon as an answer says the person held Escape (P1-6), before
   * the call that carried it returns, so a batch's next step is refused.
   */
  onPersonStop(listener: () => void): void {
    this.#onStop = listener;
  }

  /** Whether the person's own clicks, keys or wheel have turned up in the running call's answers so far. */
  get humanInputInCall(): boolean {
    return this.#toolContext.getStore()?.input.human === true;
  }

  /** @param key Which conversation this driver belongs to. */
  constructor(readonly key: string) {}

  /** Keep an action and its observation together; stop/failure cancels queued input. */
  run<T>(operation: () => Promise<T>, actor = ""): Promise<T> {
    const epoch = this.#interactionEpoch;
    const own = this.#actorEpochs.get(actor) ?? 0;
    const result = this.#toolTail.then(async () => {
      if (epoch !== this.#interactionEpoch || own !== (this.#actorEpochs.get(actor) ?? 0)) {
        throw new ComputerError("refused", { message: "Computer state changed while this call was queued. Observe status before sending new input." });
      }
      try {
        return await this.#toolContext.run({ epoch, input: new InputUpdates() }, operation);
      } catch (error) {
        this.#actorEpochs.set(actor, (this.#actorEpochs.get(actor) ?? 0) + 1);
        // Bounded: a long chat with many settled workers forgets the oldest.
        // A call still queued for a forgotten actor reads a changed epoch and
        // is refused, which is the safe direction to be wrong in.
        if (this.#actorEpochs.size > 64) this.#actorEpochs.delete(this.#actorEpochs.keys().next().value ?? "");
        throw error;
      }
    });
    this.#toolTail = result.then(() => undefined, () => undefined);
    return result;
  }

  async runTool(operation: () => Promise<ToolAnswer>, actor = ""): Promise<ToolAnswer> {
    let updates: InputUpdates | undefined;
    try {
      return await this.run(async () => {
        updates = this.#toolContext.getStore()?.input;
        const result = await operation();
        return updates?.decorate(result) ?? result;
      }, actor);
    } catch (error) {
      if (updates === undefined || !updates.hasUpdates) throw error;
      return updates.decorate({ isError: true, content: [{ type: "text", text: error instanceof Error ? error.message : "Computer input failed." }] });
    }
  }

  get running(): boolean {
    return this.#child !== undefined;
  }

  get releasing(): boolean { return this.#closing !== undefined; }

  /** A native request is out and unanswered: its outcome is not yet known. */
  get busy(): boolean { return this.#pending.size > 0; }

  #offered: OfferedObservation | undefined;
  #offeredFrames: FrameRecord[] = [];
  #latest: SharedObservation | undefined;

  /**
   * A frame the running call is handing its caller: a picture or a read
   * whose id coordinates may name. The server records it under the caller
   * once the call is done, so a frame is only ever its taker's.
   */
  offerFrame(frame: FrameRecord): void {
    this.#offeredFrames.push(frame);
  }

  takeOfferedFrames(): readonly FrameRecord[] {
    const frames = this.#offeredFrames;
    this.#offeredFrames = [];
    return frames;
  }

  /**
   * A picture the running call took. It becomes the conversation's shared
   * observation only when the server commits it with who took it and the
   * desktop's change count, so a half-finished call never shows a reader an
   * observation without its provenance.
   */
  offerObservation(observation: OfferedObservation): void {
    this.#offered = observation;
  }

  takeOffered(): OfferedObservation | undefined {
    const offered = this.#offered;
    this.#offered = undefined;
    return offered;
  }

  commitObservation(observation: SharedObservation | undefined): void {
    this.#latest = observation;
  }

  get latestObservation(): SharedObservation | undefined {
    return this.#latest;
  }

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
          // A torn answer to a request still waiting fails that request now,
          // rather than leaving it to its deadline with the outcome unknown.
          const torn = tornId(trimmed);
          const waiting = torn === undefined ? undefined : this.#pending.get(torn);
          if (torn === undefined || waiting === undefined) return;
          this.#pending.delete(torn);
          clearTimeout(waiting.timer);
          waiting.reject(new ComputerError("driver", { message: "The desktop driver's answer could not be read, so this call's outcome is unknown. Observe status before any further input; do not replay it automatically." }));
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
        const reported = record["userInput"];
        if (typeof reported === "object" && reported !== null && (reported as Record<string, unknown>)["stop"] === true) this.#onStop?.();
        if (record["ok"] === true) waiting.resolve(record["result"]);
        else {
          const said = record["error"];
          waiting.reject(classify(typeof said === "string" ? said : "The driver refused without saying why.", record["code"]));
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

  /**
   * One operation, answered. The only door to a running driver, so also the
   * only place the idle timer is renewed.
   */
  async request(op: string, args: Record<string, unknown> = {}): Promise<unknown> {
    const context = this.#toolContext.getStore();
    const epoch = context?.epoch;
    if (this.#closing !== undefined && !await this.#closing) {
      throw new ComputerError("refused", { message: "The previous driver has not confirmed orderly shutdown. Wait for it to exit and observe the desktop again before sending input." });
    }
    if (epoch !== undefined && epoch !== this.#interactionEpoch) throw new ComputerError("refused", { message: "Computer control was stopped or replaced. Observe status before continuing." });
    checkDesktopGuard();
    const child = await this.#launch();
    if (epoch !== undefined && epoch !== this.#interactionEpoch) throw new ComputerError("refused", { message: "Computer control changed while the driver started. Observe status again." });
    checkDesktopGuard();
    this.#touch();
    const id = this.#next++;
    const budget = requestBudget(op, args);
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new ComputerError("driver", {
          message: `The desktop driver did not answer "${op}" within ${String(Math.ceil(budget / 1000))} seconds, so its outcome is unknown. It has been stopped; the next call starts it again. Observe before any further input; do not replay it automatically.`,
        }));
        void this.close();
      }, budget);
      this.#pending.set(id, { resolve, reject, timer, deadlineAt: Date.now() + budget, input: context?.input });
      child.stdin.write(`${JSON.stringify({ id, op, args: { ...args, observationId: createStudioUuid() } })}\n`);
    });
  }

  /** Refuse new input now; let the active call reach the driver's cleanup. */
  async close(): Promise<boolean> {
    const child = this.#child;
    // Reuse the active request's deadline, rather than granting another minute
    // or killing a healthy drag/hold before its finally block releases input.
    const drainMs = Math.max(2000, ...[...this.#pending.values()].map((waiting) => waiting.deadlineAt - Date.now() + 2000));
    this.#forget();
    for (const waiting of this.#pending.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new ComputerError("refused", { message: "Computer control stopped before this call's outcome was observed. Reobserve before further input; do not replay it automatically." }));
    }
    this.#pending.clear();
    if (this.#closing !== undefined) return this.#closing;
    if (child === undefined) return true;
    const closing = new Promise<boolean>((resolve) => {
      const done = (): void => {
        clearTimeout(force);
        if (this.#closing === closing) this.#closing = undefined;
        resolve(child.exitCode === 0);
      };
      const force = setTimeout(() => {
        child.kill();
        resolve(false);
      }, drainMs);
      child.once("exit", done);
      // Closing stdin is the driver's signal to leave its loop; a kill is
      // only for one that does not.
      child.stdin.end();
    });
    this.#closing = closing;
    try { return await closing; } finally {
      // A kill request is not confirmed exit. Keep ownership fenced until the
      // exit callback, even when the bounded shutdown wait already returned.
      if (this.#closing === closing && (child.exitCode !== null || child.signalCode !== null)) this.#closing = undefined;
    }
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
