import type {
  CapabilityDescriptor,
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
  /**
   * Everything the call touches, when that can be more than one resource.
   *
   * A single `resource` cannot describe a command line that names three
   * programs: approving the first would silently approve the other two, and
   * the seam where a wrong guess becomes an unreviewed execution is exactly
   * there. When this is present the gate authorizes every entry and this
   * field, not {@link ToolDefinition.resource}, is the answer to "what does
   * this call touch". `resource` stays the first entry, for callers that want
   * one label for a snapshot.
   */
  readonly resources?: (input: Input, context: ToolContext) => readonly string[];
  readonly execute: (input: Input, context: ToolContext) => Promise<Output>;
  /**
   * How long this tool may take, when the shared default is wrong for it.
   *
   * Declared next to the tool because the tool is what knows. `shell` exists to
   * run builds and test suites, and the gate's two-minute default is not a
   * deadline for those — it is a guarantee they fail.
   *
   * That was a real bug rather than a hypothetical: `shell` clamped its own
   * `timeoutMs` to ten minutes while the gate abandoned every call at two, so
   * the clamp promised time it could not give. Two bounds disagreed because
   * neither could see the other. See `T-15`.
   *
   * An operator's `timeoutByCapability` still wins over this. The tool states
   * what it needs; whoever runs the harness has the last word.
   */
  readonly deadlineMs?: number;
}

/** Any tool, for storage in the registry where the parameters are unknown. */
/** Convenience for declaring a tool without widening its types. */
export function defineStudioTool<Input, Output>(
  definition: ToolDefinition<Input, Output>,
): ToolDefinition<Input, Output> {
  return definition;
}

/** The effects the gate must find a sandbox willing to contain. */