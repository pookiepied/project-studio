import { ExtendError } from "../extend/errors.js";
import type { StudioUuid } from "../identity/uuid.js";

export type ExecutionOutcome = "completed" | "aborted" | "failed" | "unknown";

export type OutcomeReason =
  | "user_stop"
  | "deadline"
  | "transport_loss"
  | "child_exit"
  | "provider_failure";

export interface OutcomeRecord {
  readonly outcome: ExecutionOutcome;
  readonly reason: OutcomeReason;
  readonly operationId?: StudioUuid;
  readonly requestId?: string;
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * One outcome for every way a submission or tool call can end.
 *
 * The mapping is deliberately small and stable so the front end and
 * recovery can branch on `outcome` without parsing messages.
 *
 * - user_stop / deadline / transport_loss / child_exit / provider_failure
 *   all have a single `outcome` — the caller does not need to know which
 *   subsystem produced the signal.
 * - `unknown` is for the case where a side effect may have happened but
 *   its durable result is missing. It is never retried automatically for
 *   non-idempotent capabilities.
 */
export function outcomeFor(reason: OutcomeReason, idempotent: boolean): OutcomeRecord {
  switch (reason) {
    case "user_stop":
      return {
        outcome: "aborted",
        reason,
        message: "The user stopped the run. The work settled as aborted.",
        retryable: false,
      };
    case "deadline":
      return {
        outcome: "failed",
        reason,
        message: "The work exceeded its deadline and was abandoned.",
        retryable: false,
      };
    case "transport_loss":
      return {
        outcome: "unknown",
        reason,
        // Desktop disconnect without an explicit abort leaves the Harness
        // work running. The client can reconnect and observe the same
        // submission. Only a Flue `abort` makes it `aborted`.
        message: "The client transport was lost. The work continues and can be observed after reconnect.",
        retryable: false,
      };
    case "child_exit":
      return {
        outcome: "failed",
        reason,
        message: "A child process or MCP server exited before the work completed.",
        retryable: false,
      };
    case "provider_failure":
      return {
        outcome: "failed",
        reason,
        message: "The model provider failed to complete the turn.",
        retryable: true,
      };
    default: {
      const exhaustive: never = reason;
      throw new ExtendError("internal", {
        message: `Unhandled outcome reason: ${String(exhaustive)}`,
      });
    }
  }
}

export function isRetryableForUnknown(idempotent: boolean, outcome: ExecutionOutcome): boolean {
  if (outcome !== "unknown") return false;
  return idempotent;
}
