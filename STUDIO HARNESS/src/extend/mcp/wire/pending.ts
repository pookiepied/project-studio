/**
 * Correlation for JSON-RPC requests over a single MCP connection.
 *
 * Sending a request means waiting for a response with a matching id, and every
 * failure mode here is a leak. This registry owns the map, the timeout, and the
 * abort handling — so after every terminal path the map is empty, and a late
 * response for an id that has already timed out is normal rather than
 * exceptional.
 */

import { ExtendError } from "../../errors.js";

export type PendingId = string | number;

/**
 * What a cancelled request rejects with when the caller supplied no reason.
 *
 * An `ExtendError` rather than the `DOMException` the platform would hand us.
 * Every failure this harness raises carries a domain and a kind so telemetry
 * has one identity to group by, and an error without one is counted as
 * `unclassified` — a measurable gap, not a category. A caller's own
 * `signal.reason` is still passed through untouched.
 */
function cancelled(): ExtendError {
  return new ExtendError("cancelled");
}

export interface PendingOptions {
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

interface Entry {
  readonly resolve: (value: unknown) => void;
  readonly reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout> | undefined;
  readonly signal: AbortSignal | undefined;
  abortHandler: (() => void) | undefined;
}

/**
 * Tracks requests that have been sent and not yet answered.
 *
 * Ids are unique for the life of the connection — `nextId` increments and is
 * never reused, even after `rejectAll`. Registering a request returns a
 * promise that settles when a response arrives, when its timeout fires, when
 * its AbortSignal aborts, or when `rejectAll` is called for a dead connection.
 */
export class PendingRequests {
  #nextId = 1;
  readonly #pending = new Map<PendingId, Entry>();

  /** The next id, unique for the life of this connection. */
  nextId(): number {
    const id = this.#nextId;
    this.#nextId += 1;
    return id;
  }

  /** How many requests are still waiting for a response. */
  get size(): number {
    return this.#pending.size;
  }

  /**
   * Registers a pending request.
   *
   * The caller supplies the id — typically from `nextId` — so the id that is
   * sent on the wire and the id that is waited for are the same value. An id
   * may be a string or a number; `null` is not a valid request id and is not
   * accepted here.
   */
  register(id: PendingId, options: PendingOptions = {}): Promise<unknown> {
    if (this.#pending.has(id)) {
      throw new ExtendError("internal", {
        message: `A request with id ${String(id)} is already pending.`,
      });
    }

    // If the signal is already aborted, do not add an entry that would
    // immediately need to be removed — reject right away and keep the map
    // empty, which is the invariant every terminal path must preserve.
    if (options.signal?.aborted) {
      return Promise.reject(options.signal.reason ?? cancelled());
    }

    return new Promise<unknown>((resolve, reject) => {
      const entry: Entry = {
        resolve,
        reject,
        timer: undefined,
        signal: options.signal,
        abortHandler: undefined,
      };

      // Stored first, so a timeout or abort that fires on the next tick finds
      // the entry it has to remove.
      this.#pending.set(id, entry);

      if (options.timeoutMs !== undefined) {
        entry.timer = setTimeout(() => {
          this.#settle(id, "reject", new ExtendError("timed_out"));
        }, options.timeoutMs);
      }

      if (options.signal !== undefined) {
        const signal = options.signal;
        entry.abortHandler = () => {
          this.#settle(id, "reject", signal.reason ?? cancelled());
        };
        signal.addEventListener("abort", entry.abortHandler, { once: true });
      }
    });
  }

  /**
   * The one way a request leaves the map.
   *
   * Every terminal path — a response, an error, a timeout, an abort, a dead
   * connection — clears the timer, drops the abort listener, removes the entry,
   * and only then settles the promise. Written once because it was written five
   * times: each copy was a chance for one of the four steps to be forgotten,
   * and a forgotten step is either a timer firing after the answer arrived or
   * an entry that never leaves.
   *
   * Removing before settling matters. Code waiting on the promise must not
   * observe a map that still contains the request it was just told about.
   */
  #settle(id: PendingId, how: "resolve" | "reject", value: unknown): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) return false;

    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (entry.signal !== undefined && entry.abortHandler !== undefined) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }
    this.#pending.delete(id);

    if (how === "resolve") entry.resolve(value);
    else entry.reject(value);
    return true;
  }

  /**
   * Settles a pending request with a result.
   *
   * Returns true when an entry was found and settled, false for an unknown id.
   * A late response for something already timed out or aborted is ignored
   * rather than thrown — it is normal when the server is slow.
   */
  resolve(id: PendingId, value: unknown): boolean {
    return this.#settle(id, "resolve", value);
  }

  /**
   * Settles a pending request with an error.
   *
   * Returns true when an entry was found and settled, false for an unknown id.
   */
  reject(id: PendingId, reason: unknown): boolean {
    return this.#settle(id, "reject", reason);
  }

  /**
   * Rejects every outstanding request and empties the map.
   *
   * Called when the connection dies — the transport is gone, so no more
   * responses will arrive for anything still pending.
   */
  rejectAll(reason: unknown = new ExtendError("disconnected")): void {
    // Ids are taken first: settling one may run waiting code synchronously, and
    // iterating the live map while that code could register a new request is
    // how a brand-new request gets rejected by a failure it never saw.
    for (const id of [...this.#pending.keys()]) {
      this.#settle(id, "reject", reason);
    }
  }
}
