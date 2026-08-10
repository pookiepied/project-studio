/**
 * The shared failure contract for the harness.
 *
 * Every subsystem defines its own failure *vocabulary* — sign-in does not fail
 * the way a database does — but they all carry the same shape, so a caller that
 * does not know the subsystem can still branch on the failure, and so telemetry
 * has one identity to group by.
 *
 * The rule this file exists to enforce: a new subsystem adds its domain here and
 * throws a `StudioError`. Anything else surfaces as the `unclassified` domain,
 * which is deliberately visible in telemetry rather than silently normal.
 */

/**
 * One entry per subsystem that can fail.
 *
 * This union is closed on purpose. Adding a subsystem is meant to be a typecheck
 * failure until it is registered here, which is what keeps the taxonomy honest
 * as phases 9-18 add permissions, tools, MCP, skills, and memory.
 *
 * `unclassified` is not a subsystem. It is what a raw `Error`, a thrown string,
 * or a third-party rejection becomes when it reaches the reporter without ever
 * having been classified — a measurable gap, not a category.
 */
export type StudioErrorDomain =
  | "auth"
  | "credentials"
  | "models"
  /**
   * The Studio gateway transport. Separate from `models` on purpose: both have
   * a `configuration` failure, and collapsing them would give two unrelated
   * conditions the same code.
   */
  | "gateway"
  | "storage"
  | "observability"
  | "permissions"
  | "sandbox"
  /**
   * Reaching an address at all: judging a destination, pinning the address a
   * name resolved to, and the connection itself.
   *
   * Separate from `retrieval`: "that address is refused" and "Tavily says your
   * plan is used up" are different situations with different answers, and this
   * one is asked by three subsystems that share nothing else — page reading,
   * MCP over HTTP, and connectors. `DestinationError` reports here for the same
   * reason, having previously reported as `retrieval` when page reading was its
   * only caller.
   */
  | "network"
  /** Native capabilities and the gate every call passes through. */
  | "tools"
  /** Spawning and supervising a child process. */
  | "process"
  /**
   * Locating the third-party binaries the harness runs. Separate from
   * `process`: "ripgrep is not installed" and "ripgrep crashed" need different
   * answers from the user, so they must not share a code.
   */
  | "vendor"
  /**
   * The undo history. Separate from `tools`: "the write failed" and "the write
   * succeeded but could not be made reversible" are different situations and
   * need different answers.
   */
  | "snapshots"
  /**
   * Web search and page reading, and the third-party services behind them.
   * Separate from `tools`: "the search tool was refused" and "Tavily says your
   * plan is used up" need different answers from the user, and only the second
   * one is fixed by opening a billing page.
   */
  | "retrieval"
  /**
   * What can be added to STUDIO — MCP servers, skills, hooks — and the spine
   * that decides which of them a project gets. Separate from `tools`: "the gate
   * refused this call" and "this server is not switched on for this project"
   * are different situations, and only the second one is fixed in settings.
   */
  | "extend"
  | "unclassified";

/** Stable, machine-readable failure identity: `${domain}.${kind}`. */
export type StudioErrorCode = string;

/**
 * The only error representation that may leave the process — a log line, a
 * telemetry attribute, an API response, or a UI message.
 *
 * It deliberately has no `stack` and no `cause`. A stack leaks filesystem
 * layout, and a cause is frequently a third-party error whose message echoes
 * the value that failed; the credential store has been observed doing exactly
 * that with the secret being written.
 */
export interface StudioErrorReport {
  readonly code: StudioErrorCode;
  readonly domain: StudioErrorDomain;
  readonly kind: string;
  readonly name: string;
  readonly message: string;
  readonly retryable: boolean;
}

export interface StudioErrorOptions {
  /** Overrides the subsystem's default message for the kind. */
  readonly message?: string;
  /**
   * Whether an identical retry could plausibly succeed. Decided by the
   * subsystem that knows, never inferred from the message.
   */
  readonly retryable?: boolean;
  /**
   * Retained for local debugging only. It is never serialized, never logged,
   * and never reported — see `StudioErrorReport`.
   */
  readonly cause?: unknown;
}

/**
 * Base class for every failure the harness raises on purpose.
 *
 * Subclasses declare `domain` as a class field and set `kind` in their
 * constructor; `code` is derived so the two can never disagree.
 */
export abstract class StudioError extends Error {
  abstract readonly domain: StudioErrorDomain;
  readonly kind: string;
  readonly retryable: boolean;

  protected constructor(kind: string, message: string, options: StudioErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.kind = kind;
    this.retryable = options.retryable ?? false;
  }

  get code(): StudioErrorCode {
    return `${this.domain}.${this.kind}`;
  }

  /** The safe projection. Callers outside the harness see only this. */
  toReport(): StudioErrorReport {
    return {
      code: this.code,
      domain: this.domain,
      kind: this.kind,
      name: this.name,
      message: this.message,
      retryable: this.retryable,
    };
  }
}

export function isStudioError(value: unknown): value is StudioError {
  return value instanceof StudioError;
}

/** True when the failure is a known kind within a known subsystem. */
export function isStudioErrorOfDomain(
  value: unknown,
  domain: StudioErrorDomain,
): value is StudioError {
  return isStudioError(value) && value.domain === domain;
}
