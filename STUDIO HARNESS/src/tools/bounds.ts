import {
  capabilityKey,
  type CapabilityDescriptor,
} from "../contracts/capabilities.js";
import { ToolError } from "./errors.js";

/**
 * How long a tool call may take, and how many may run at once.
 *
 * `runProcess` already bounds a *subprocess*. This bounds a *call*, which is a
 * different thing: a tool that hangs in pure JavaScript never reaches a
 * subprocess, and nothing here limits how many calls a model can start at
 * once. Both gaps are the same shape — the gate hands control to tool code and,
 * until now, had no way of getting it back.
 *
 * Three bounds, and each answers a different failure:
 *
 * - **Deadline** — the call is abandoned. Answers "this never returns".
 * - **Cancellation** — the caller withdrew. Answers "the user pressed stop
 *   and expects it to actually stop".
 * - **Concurrency** — calls queue. Answers "the model asked for forty things
 *   simultaneously and the machine fell over".
 */

/** Two minutes, matching the subprocess default so the two do not disagree. */
const DEFAULT_TIMEOUT_MS = 120_000;

/**
 * Eight at once.
 *
 * High enough that ordinary parallel reads are not serialised — batching
 * independent calls is a real latency win and this must not undo it — and low
 * enough that a model asking for forty greps does not start forty ripgrep
 * processes.
 */
const DEFAULT_MAX_CONCURRENT = 8;

export interface CallBoundsOptions {
  readonly timeoutMs?: number;
  readonly maxConcurrent?: number;
  /**
   * Per-capability deadlines, by capability key.
   *
   * The default is one number because most tools are alike. This exists for
   * the ones that genuinely are not — a `git clone` and a `read` do not
   * deserve the same patience, and giving everything the slowest tool's
   * deadline makes a hang indistinguishable from work.
   */
  readonly timeoutByCapability?: Readonly<Record<string, number>>;
}

interface Waiter {
  readonly admit: () => void;
  readonly refuse: (reason: unknown) => void;
  readonly release: () => void;
}

/**
 * A FIFO permit queue.
 *
 * FIFO rather than a priority scheme on purpose: a model's calls have no
 * meaningful priority relative to each other, and inventing one would make
 * "why is this slow" unanswerable.
 */
class Permits {
  readonly #limit: number;
  #active = 0;
  readonly #waiting: Waiter[] = [];

  constructor(limit: number) {
    this.#limit = Math.max(1, limit);
  }

  get active(): number {
    return this.#active;
  }

  get queued(): number {
    return this.#waiting.length;
  }

  /** Resolves to the release function, or rejects if the signal fires first. */
  async acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw signal.reason;

    const release = (): void => {
      this.#active -= 1;
      const next = this.#waiting.shift();
      if (next) {
        this.#active += 1;
        next.admit();
      }
    };

    if (this.#active < this.#limit) {
      this.#active += 1;
      return release;
    }

    return new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = {
        admit: () => {
          signal.removeEventListener("abort", onAbort);
          resolve(release);
        },
        refuse: reject,
        release,
      };

      const onAbort = (): void => {
        // Removed from the queue, not merely rejected. A waiter left behind
        // would be admitted later and hold a permit nobody releases, and the
        // gate would deadlock a few calls at a time.
        const index = this.#waiting.indexOf(waiter);
        if (index !== -1) this.#waiting.splice(index, 1);
        waiter.refuse(signal.reason);
      };

      signal.addEventListener("abort", onAbort, { once: true });
      this.#waiting.push(waiter);
    });
  }
}

/** Why a call ended early, and therefore what the caller may do next. */
type EndedReason = "timeout" | "cancelled";

/**
 * Explains an abandoned call to the model that made it.
 *
 * The distinction that matters is not why it ended but **whether anything
 * happened**. A call abandoned in the queue never ran, so repeating it is
 * always safe. A call abandoned mid-flight has an unknown outcome, and whether
 * repeating it is safe is exactly what `CapabilityDescriptor.idempotent`
 * records — this is the moment that field exists for.
 */
function endedError(
  descriptor: CapabilityDescriptor,
  reason: EndedReason,
  started: boolean,
): ToolError {
  const key = capabilityKey(descriptor.id);
  const what = reason === "timeout" ? "took too long" : "was stopped";

  if (!started) {
    return new ToolError(reason === "timeout" ? "timed_out" : "cancelled", {
      message: `${key} ${what} while waiting to start, so nothing was done. Running it again is safe.`,
      tool: key,
    });
  }

  return new ToolError(reason === "timeout" ? "timed_out" : "cancelled", {
    message: descriptor.idempotent
      ? `${key} ${what} and was abandoned. It may have finished; running it again is safe.`
      : `${key} ${what} and was abandoned. It may or may not have finished — check the current state before doing it again.`,
    tool: key,
  });
}

export class CallBounds {
  readonly #permits: Permits;
  readonly #timeoutMs: number;
  readonly #timeoutByCapability: Readonly<Record<string, number>>;
  /** What each tool asked for at registration. Operator options still win. */
  readonly #declared = new Map<string, number>();

  constructor(options: CallBoundsOptions = {}) {
    this.#permits = new Permits(options.maxConcurrent ?? DEFAULT_MAX_CONCURRENT);
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.#timeoutByCapability = options.timeoutByCapability ?? {};
  }

  /** For the audit surface and for tests. */
  get inFlight(): { active: number; queued: number } {
    return { active: this.#permits.active, queued: this.#permits.queued };
  }

  /**
   * Records what a tool says it needs.
   *
   * Kept separate from `timeoutByCapability` so precedence stays readable:
   * operator, then tool, then the shared default. An operator who sets a limit
   * meant it, and a tool asking for more must not quietly overrule them.
   */
  declare(descriptor: CapabilityDescriptor, deadlineMs: number | undefined): void {
    if (deadlineMs === undefined) return;
    this.#declared.set(capabilityKey(descriptor.id), deadlineMs);
  }

  deadlineFor(descriptor: CapabilityDescriptor): number {
    const key = capabilityKey(descriptor.id);
    return this.#timeoutByCapability[key] ?? this.#declared.get(key) ?? this.#timeoutMs;
  }

  /**
   * Runs a call within its bounds.
   *
   * `execute` is handed a signal that fires on either the deadline or the
   * caller's cancellation. Tools that reach a subprocess forward it and are
   * genuinely interrupted; tools that do not are *abandoned* rather than
   * stopped, and the error says so instead of implying more control than we
   * have.
   *
   * The deadline covers queue time as well as execution. From the caller's
   * side the wait is part of the call, and a bound that excluded it would let
   * a saturated gate hold a call open indefinitely while technically honouring
   * its timeout.
   */
  async run<T>(
    descriptor: CapabilityDescriptor,
    callSignal: AbortSignal | undefined,
    execute: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const timeout = AbortSignal.timeout(this.deadlineFor(descriptor));
    const signal =
      callSignal === undefined ? timeout : AbortSignal.any([timeout, callSignal]);

    const reason = (): EndedReason => (timeout.aborted ? "timeout" : "cancelled");

    let release: (() => void) | undefined;
    try {
      release = await this.#permits.acquire(signal);
    } catch {
      throw endedError(descriptor, reason(), false);
    }

    try {
      const work = execute(signal);
      // The abandoned promise still settles, and an unobserved rejection would
      // surface as an unhandled rejection unrelated to any live call.
      work.catch(() => undefined);

      return await Promise.race([
        work,
        new Promise<never>((_resolve, rejectRace) => {
          if (signal.aborted) {
            rejectRace(endedError(descriptor, reason(), true));
            return;
          }
          signal.addEventListener(
            "abort",
            () => rejectRace(endedError(descriptor, reason(), true)),
            { once: true },
          );
        }),
      ]);
    } finally {
      release();
    }
  }
}
