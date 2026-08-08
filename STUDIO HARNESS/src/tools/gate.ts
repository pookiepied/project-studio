import {
  capabilityKey,
  type CapabilityDescriptor,
  type ExecutionScope,
} from "../contracts/capabilities.js";
import { isStudioError } from "../contracts/errors.js";
import type { ErrorReporter } from "../observability/error-reporter.js";
import type { PermissionKernel } from "../permissions/kernel.js";
import type { LocalSandbox } from "../sandbox/local-sandbox.js";
import { ToolError } from "./errors.js";
import type { ToolContext, ToolDefinition } from "./types.js";

/**
 * The single door between "the model asked for something" and "code ran".
 *
 * Everything executable passes through here — native tools now, MCP tools and
 * skill actions later — which is what makes "what is this agent allowed to do"
 * a question with an answer. The alternative, each tool checking for itself, is
 * opt-in: a tool that forgets is unguarded, and nothing in review shows the
 * omission.
 *
 * The gate owns authorization, containment, and reporting. Tools own only their
 * own work.
 */

interface RegisteredTool {
  readonly descriptor: CapabilityDescriptor;
  readonly resourceKind: ToolDefinition<unknown, unknown>["resourceKind"];
  readonly parse: (input: unknown) => unknown;
  readonly resource: (input: unknown, context: ToolContext) => string | undefined;
  readonly execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export interface CallGateOptions {
  readonly kernel: PermissionKernel;
  readonly sandbox: LocalSandbox;
  readonly reporter?: ErrorReporter;
}

export interface ToolCall {
  /** The capability key the model named, e.g. `native/read`. */
  readonly name: string;
  readonly input: unknown;
  readonly scope: ExecutionScope;
  readonly signal?: AbortSignal;
}

export class CallGate {
  readonly #tools = new Map<string, RegisteredTool>();
  readonly #kernel: PermissionKernel;
  readonly #sandbox: LocalSandbox;
  readonly #reporter: ErrorReporter | undefined;

  constructor(options: CallGateOptions) {
    this.#kernel = options.kernel;
    this.#sandbox = options.sandbox;
    this.#reporter = options.reporter;
  }

  /**
   * Registers a tool here and its capability with the kernel, together.
   *
   * One call, so a tool cannot become callable without also becoming
   * decidable. Registering them separately would allow a tool the gate can
   * reach but the kernel has never heard of.
   */
  register<Input, Output>(tool: ToolDefinition<Input, Output>): void {
    const key = capabilityKey(tool.descriptor.id);

    if (this.#tools.has(key)) {
      throw new ToolError("name_conflict", {
        message: `Two tools are registered as "${key}".`,
        tool: key,
      });
    }

    this.#kernel.register(tool.descriptor);
    // One cast, at the one boundary where the parameter types are erased. The
    // functions are only ever called with values `parse` produced.
    this.#tools.set(key, tool as unknown as RegisteredTool);
  }

  /** What the model may be told about. */
  list(): readonly CapabilityDescriptor[] {
    return [...this.#tools.values()].map((tool) => tool.descriptor);
  }

  async call(call: ToolCall): Promise<unknown> {
    const tool = this.#tools.get(call.name);
    if (!tool) {
      // Reported, not silent: a model calling something that does not exist is
      // usually a stale tool list, which is worth seeing in telemetry.
      throw this.#report(
        new ToolError("unknown_tool", {
          message: `There is no tool named "${call.name}".`,
          tool: call.name,
        }),
        call.name,
      );
    }

    const context: ToolContext = {
      scope: call.scope,
      sandbox: this.#sandbox,
      signal: call.signal,
    };

    try {
      const input = tool.parse(call.input);

      // Resolved before authorization on purpose. A path outside the workspace
      // is refused whatever the permissions say, and it must never reach the
      // matcher: `src/../../.ssh/id_rsa` would otherwise be tested against a
      // rule scoped to `src/**` in its unresolved form and pass.
      const resource = tool.resource(input, context);

      await this.#kernel.authorize(tool.descriptor.id, call.scope, {
        resource,
        kind: tool.resourceKind,
        // Supplied so the kernel can offer "this project" as an approval scope
        // and, more importantly, so it can offer nothing above it.
        root: this.#sandbox.policy.workspaceRoot,
      });

      // Permission is not containment. Approval says the user agreed; this says
      // we can actually hold the boundary. Both are required, and the sandbox
      // is asked second so an unapproved call is refused before we consider
      // whether we could have contained it.
      for (const effect of tool.descriptor.effects) {
        this.#sandbox.assertSupports(effect);
      }

      if (call.signal?.aborted) {
        throw new ToolError("execution_failed", {
          message: "The call was cancelled.",
          tool: call.name,
        });
      }

      return await tool.execute(input, context);
    } catch (error) {
      throw this.#report(error, call.name);
    }
  }

  /**
   * Reports a failure and hands it back unchanged.
   *
   * Unchanged matters: the caller branches on `SandboxError` and
   * `PermissionError`, and wrapping everything in a `ToolError` here would
   * flatten a refusal and a crash into one indistinguishable failure.
   */
  #report(error: unknown, tool: string): unknown {
    this.#reporter?.report(error, {
      operation: "tools.call",
      tool,
      ...(isStudioError(error) ? { error_code: error.code } : {}),
    });
    return error;
  }
}
