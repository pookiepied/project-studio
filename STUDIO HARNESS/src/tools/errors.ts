import { StudioError } from "../contracts/errors.js";

export type ToolErrorKind =
  /** The model called something that is not registered. */
  | "unknown_tool"
  /** The arguments did not match what the tool accepts. */
  | "invalid_input"
  /** Two tools claimed the same name. */
  | "name_conflict"
  /** The tool ran and failed on its own terms. */
  | "execution_failed"
  /** The call passed its deadline and was abandoned. */
  | "timed_out"
  /** The caller withdrew the call. */
  | "cancelled"
  /** The model retained a tool whose provider is currently unavailable. */
  | "unavailable"
  | "internal";

const MESSAGE_BY_KIND: Record<ToolErrorKind, string> = {
  unknown_tool: "That tool is not available.",
  invalid_input: "The tool was called with arguments it cannot accept.",
  name_conflict: "Two tools are registered under the same name.",
  execution_failed: "The tool could not complete.",
  timed_out: "The tool took too long and was stopped.",
  cancelled: "The call was stopped.",
  unavailable: "That tool is currently unavailable.",
  internal: "The tool failed unexpectedly.",
};

/**
 * A failure of a tool call, phrased for the model that made it.
 *
 * These messages are returned to the model, so they say what to do differently
 * and never why the harness refused internally — a refusal that explains its
 * own reasoning teaches the model how to phrase the next attempt.
 */
export class ToolError extends StudioError {
  readonly domain = "tools" as const;
  declare readonly kind: ToolErrorKind;
  /** The tool this concerns, for telemetry. Not part of the report. */
  readonly tool: string | undefined;

  constructor(
    kind: ToolErrorKind,
    options: { message?: string; tool?: string; cause?: unknown } = {},
  ) {
    super(kind, options.message ?? MESSAGE_BY_KIND[kind], {
      retryable: false,
      ...(options.cause !== undefined ? { cause: options.cause } : {}),
    });
    this.name = "ToolError";
    this.tool = options.tool;
  }
}
