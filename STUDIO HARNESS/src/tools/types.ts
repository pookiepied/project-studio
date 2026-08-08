import type {
  CapabilityDescriptor,
  CapabilityEffect,
  ExecutionScope,
} from "../contracts/capabilities.js";
import type { ResourceKind } from "../permissions/matcher.js";
import type { LocalSandbox } from "../sandbox/local-sandbox.js";

/**
 * What a tool is, from the harness's point of view.
 *
 * Deliberately small. A tool describes itself, says what a given call touches,
 * and does its work — it does not check permission, does not resolve paths, and
 * does not report telemetry. All of that belongs to the gate, because a
 * safeguard each tool has to remember is a safeguard that will eventually be
 * forgotten, and the omission is invisible in review.
 */

export interface ToolContext {
  readonly scope: ExecutionScope;
  /** Containment. Every path a tool touches goes through this. */
  readonly sandbox: LocalSandbox;
  readonly signal: AbortSignal | undefined;
}

export interface ToolDefinition<Input, Output> {
  readonly descriptor: CapabilityDescriptor;
  /**
   * How this tool's arguments are matched by permission rules — a path for
   * filesystem tools, a command for git.
   */
  readonly resourceKind: ResourceKind;
  /**
   * Validates and narrows the model's arguments.
   *
   * Every tool parses; nothing downstream may assume a shape that was not
   * checked here. Throwing `ToolError("invalid_input")` is the contract.
   */
  readonly parse: (input: unknown) => Input;
  /**
   * What this call touches, derived from the parsed arguments.
   *
   * Returned *before* execution so it can be authorized, and resolved through
   * the sandbox first where it is a path — matching the raw argument would let
   * `src/../../.ssh/id_rsa` slip past a rule scoped to `src/**`.
   */
  readonly resource: (input: Input, context: ToolContext) => string | undefined;
  readonly execute: (input: Input, context: ToolContext) => Promise<Output>;
}

/** Any tool, for storage in the registry where the parameters are unknown. */
export type AnyTool = ToolDefinition<never, unknown>;

/** Convenience for declaring a tool without widening its types. */
export function defineStudioTool<Input, Output>(
  definition: ToolDefinition<Input, Output>,
): ToolDefinition<Input, Output> {
  return definition;
}

/** The effects the gate must find a sandbox willing to contain. */
export function effectsOf(descriptor: CapabilityDescriptor): readonly CapabilityEffect[] {
  return descriptor.effects;
}
