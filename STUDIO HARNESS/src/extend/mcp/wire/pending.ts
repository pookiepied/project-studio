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
 * its AbortSignal aborts, or when `rejectAll` is called for a dead
 * connection.
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
      return Promise.reject(
        options.signal.reason ??
          new DOMException("The request was aborted.", "AbortError"),
      );
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortHandler: (() => void) | undefined;

    const promise = new Promise<unknown>((resolve, reject) => {
      const entry: Entry = {
        resolve: (value: unknown) => {
          // Clear the other termination path so it cannot fire after we have
          // already settled. A timed-out request that stays in the map is a
          // leak, and an abort handler that fires after resolution is a second
          // rejection.
          if (timer !== undefined) clearTimeout(timer);
          if (options.signal && abortHandler !== undefined) {
            options.signal.removeEventListener("abort", abortHandler);
          }
          this.#pending.delete(id);
          resolve(value);
        },
        reject: (reason: unknown) => {
          if (timer !== undefined) clearTimeout(timer);
          if (options.signal && abortHandler !== undefined) {
            options.signal.removeEventListener("abort", abortHandler);
          }
          this.#pending.delete(id);
          reject(reason);
        },
        timer: undefined,
        signal: options.signal,
        abortHandler: undefined,
      };

      // Store first so a synchronous abort or timeout that fires on the next
      // tick sees the entry.
      this.#pending.set(id, entry);

      if (options.timeoutMs !== undefined) {
        timer = setTimeout(() => {
          const current = this.#pending.get(id);
          if (current === undefined) return;
          if (current.signal && current.abortHandler !== undefined) {
            current.signal.removeEventListener("abort", current.abortHandler);
          }
          this.#pending.delete(id);
          current.reject(new Error("The request timed out."));
        }, options.timeoutMs);
        entry.timer = timer;
      }

      if (options.signal !== undefined) {
        abortHandler = () => {
          const current = this.#pending.get(id);
          if (current === undefined) return;
          if (current.timer !== undefined) clearTimeout(current.timer);
          this.#pending.delete(id);
          current.reject(
            options.signal?.reason ??
              new DOMException("The request was aborted.", "AbortError"),
          );
        };
        entry.abortHandler = abortHandler;
        options.signal.addEventListener("abort", abortHandler, { once: true });
      }
    });

    return promise;
  }

  /**
   * Settles a pending request with a result.
   *
   * Returns true when an entry was found and settled, false for an unknown id.
   * A late response for something already timed out or aborted is ignored rather
   * than thrown — it is normal when the server is slow.
   */
  resolve(id: PendingId, value: unknown): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) return false;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (entry.signal && entry.abortHandler !== undefined) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }
    this.#pending.delete(id);
    entry.resolve(value);
    return true;
  }

  /**
   * Settles a pending request with an error.
   *
   * Returns true when an entry was found and settled, false for an unknown id.
   */
  reject(id: PendingId, reason: unknown): boolean {
    const entry = this.#pending.get(id);
    if (entry === undefined) return false;
    if (entry.timer !== undefined) clearTimeout(entry.timer);
    if (entry.signal && entry.abortHandler !== undefined) {
      entry.signal.removeEventListener("abort", entry.abortHandler);
    }
    this.#pending.delete(id);
    entry.reject(reason);
    return true;
  }

  /**
   * Rejects every outstanding request and empties the map.
   *
   * Called when the connection dies — the transport is gone, so no more
   * responses will arrive for anything that is still pending.
   */
  rejectAll(reason: unknown): void {
    const entries = [...this.#pending.values()];
    this.#pending.clear();
    for (const entry of entries) {
      if (entry.timer !== undefined) clearTimeout(entry.timer);
      if (entry.signal && entry.abortHandler !== undefined) {
        entry.signal.removeEventListener("abort", entry.abortHandler);
      }
      entry.reject(reason);
    }
  }
}
