import {
  capabilityKey,
  type CapabilityDescriptor,
  type CapabilityId,
  type ExecutionScope,
} from "../contracts/capabilities.js";
import { requiresUndoPoint } from "../contracts/effects.js";
import { isStudioError } from "../contracts/errors.js";
import type { ErrorReporter } from "../observability/error-reporter.js";
import { observeOperation, observeSynchronousOperation } from "../observability/operation.js";
import type { PermissionKernel } from "../permissions/kernel.js";
import type { LocalSandbox } from "../sandbox/local-sandbox.js";
import type { SnapshotHook } from "../snapshots/turn.js";
import { CallBounds, type CallBoundsOptions } from "./bounds.js";
import { ToolError } from "./errors.js";
import type { ToolContext, ToolDefinition } from "./types.js";
import { createObservationWriter, diagnosticRecorder } from "../observability/recorder.js";
import { diagnosticProjectedContent } from "../observability/diagnostic-value.js";
import { schemaContentFields } from "../observability/content-fields.js";

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
  readonly resources?: (input: unknown, context: ToolContext) => readonly string[];
  readonly execute: (input: unknown, context: ToolContext) => Promise<unknown>;
}

export interface CallGateOptions {
  readonly kernel: PermissionKernel;
  readonly sandbox: LocalSandbox;
  readonly reporter?: ErrorReporter;
  /**
   * Undo history. Optional, and absent means writes are simply not reversible
   * — which is the honest state for a headless test, and must not be the state
   * for any unattended mode.
   */
  readonly snapshots?: SnapshotHook;
  /**
   * Deadline, cancellation, and concurrency. Always applied — the options only
   * tune it, because a gate with no bound on how long a call may take is the
   * gap this exists to close.
   */
  readonly bounds?: CallBoundsOptions;
  /** Reports a capability hidden by an operator switch. */
  readonly onWithheld?: (event: WithheldCapability) => void;
}

export interface WithheldCapability {
  readonly capability: string;
  readonly switchName: "allowExec" | "allowNetwork";
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
  readonly #contentFields = new WeakMap<RegisteredTool, readonly string[]>();
  readonly #kernel: PermissionKernel;
  readonly #sandbox: LocalSandbox;
  readonly #reporter: ErrorReporter | undefined;
  readonly #snapshots: SnapshotHook | undefined;
  readonly #bounds: CallBounds;
  readonly #onWithheld: ((event: WithheldCapability) => void) | undefined;
  readonly #reportedWithheld = new Set<string>();

  constructor(options: CallGateOptions) {
    this.#bounds = new CallBounds(options.bounds);
    this.#kernel = options.kernel;
    this.#sandbox = options.sandbox;
    this.#reporter = options.reporter;
    this.#snapshots = options.snapshots;
    this.#onWithheld = options.onWithheld;
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
    // Registered here too, so a tool's deadline arrives with the tool rather
    // than having to be repeated in whatever constructs the gate.
    this.#bounds.declare(tool.descriptor, tool.deadlineMs);
    // One cast, at the one boundary where the parameter types are erased. The
    // functions are only ever called with values `parse` produced.
    const registered = tool as unknown as RegisteredTool;
    this.#tools.set(key, registered);
    this.#contentFields.set(registered, tool.descriptor.provenance.origin === "native" ? schemaContentFields(tool.descriptor.inputSchema) : []);
  }

  /**
   * Removes a tool, through the same one door that added it.
   *
   * Registration used to be permanent, which was fine while every tool was ours
   * and shipped in the binary. From Phase 11 a tool's provider can be switched
   * off for a project, edited, or removed, and a gate that only grows would keep
   * offering tools whose server is gone.
   *
   * All three registries move together, for the same reason `register` is one
   * call: a tool the gate can reach but the kernel has never heard of is exactly
   * the state neither is allowed to be in.
   *
   * **A call already admitted runs to completion.** `call` captures the tool
   * before it does anything, so removing it mid-flight neither cancels nor
   * corrupts that call — it only stops the next one. Waiting for in-flight work
   * before tearing a provider down belongs to the provider, which is the only
   * thing that knows what teardown means for it.
   */
  unregister(id: CapabilityId): boolean {
    const key = capabilityKey(id);
    const tool = this.#tools.get(key);
    if (!tool) return false;

    // Removed from here first, so no further call can be admitted while the
    // other two are still catching up.
    this.#tools.delete(key);
    this.#kernel.unregister(id);
    this.#bounds.undeclare(tool.descriptor);
    return true;
  }

  /**
   * Removes every tool one provider contributed.
   *
   * The operation that actually happens — a server is switched off and all of
   * its tools go at once. Doing it key by key from outside would mean the caller
   * holding its own list of what that server registered, which is a second copy
   * of something this map already knows.
   *
   * `project-studio` is a `sourceId` like any other, so this removes the native
   * tools if asked. Deliberate: a guard against that would be a special case
   * defending against a call nobody makes by accident.
   */
  unregisterSource(sourceId: string): number {
    const doomed = [...this.#tools.values()]
      .filter((tool) => tool.descriptor.provenance.sourceId === sourceId)
      .map((tool) => tool.descriptor.id);

    let removed = 0;
    for (const id of doomed) {
      if (this.unregister(id)) removed += 1;
    }
    return removed;
  }

  /** How much is running or waiting right now. For the audit surface. */
  get inFlight(): { active: number; queued: number } {
    return this.#bounds.inFlight;
  }

  /**
   * How long this capability may take, after every source has been considered.
   *
   * Exposed because two limits that disagree is what `T-15` was, and the only
   * way to see the answer was to reach inside `CallBounds`. A number a caller
   * can read is a number a caller can check.
   */
  deadlineFor(descriptor: CapabilityDescriptor): number {
    return this.#bounds.deadlineFor(descriptor);
  }

  /**
   * What the model may be told about.
   *
   * Only tools this sandbox can actually admit. A tool the model can see but
   * never use costs one wasted attempt when it tries, and costs its whole
   * schema in the cached prefix on **every turn** — paid for, forever, to
   * advertise a refusal. See `T-28`.
   *
   * Asked of the sandbox rather than decided here, so the list and the call can
   * never disagree. Permission is deliberately *not* consulted: "you have not
   * approved this yet" is a question with an answer, and hiding the tool would
   * take away the user's chance to give it.
   */
  list(): readonly CapabilityDescriptor[] {
    return [...this.#tools.values()]
      .map((tool) => tool.descriptor)
      .filter((descriptor) => {
        if (this.#sandbox.supports(descriptor)) return true;

        const switchName = this.#withheldSwitch(descriptor);
        if (switchName === undefined) return false;

        const capability = capabilityKey(descriptor.id);
        const reportKey = `${capability}\0${switchName}`;
        if (!this.#reportedWithheld.has(reportKey)) {
          this.#reportedWithheld.add(reportKey);
          this.#onWithheld?.({ capability, switchName });
        }
        return false;
      });
  }

  /**
   * Everything registered, admissible or not.
   *
   * For a settings screen, which has to render a capability that is switched
   * off in order to offer switching it back on. The model never sees this.
   */
  listAll(): readonly CapabilityDescriptor[] {
    return [...this.#tools.values()].map((tool) => tool.descriptor);
  }

  #withheldSwitch(
    descriptor: CapabilityDescriptor,
  ): WithheldCapability["switchName"] | undefined {
    if (descriptor.effects.includes("execute") && !this.#sandbox.policy.allowExec) {
      return "allowExec";
    }
    if (descriptor.effects.includes("network") && !this.#sandbox.policy.allowNetwork) {
      return "allowNetwork";
    }
    return undefined;
  }

  call(call: ToolCall): Promise<unknown> {
    return observeOperation("tool", "tools.call", () => this.#call(call), { capability: call.name }, call.scope.conversationId);
  }

  async #call(call: ToolCall): Promise<unknown> {
    const tool = this.#tools.get(call.name);
    const record = createObservationWriter();
    if (tool !== undefined) record({ name: "tools.input", phase: "progress", attributes: { capability: call.name },
      ...(diagnosticRecorder.capturesContent(call.scope.conversationId)
        ? { content: diagnosticProjectedContent(call.input, this.#contentFields.get(tool) ?? []) } : {}) });
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
      const input = observeSynchronousOperation("tool", "tools.validate", () => tool.parse(call.input));

      // Resolved before authorization on purpose. A path outside the workspace
      // is refused whatever the permissions say, and it must never reach the
      // matcher: `src/../../.ssh/id_rsa` would otherwise be tested against a
      // rule scoped to `src/**` in its unresolved form and pass.
      //
      // A tool may name more than one resource - a command line that chains
      // three programs is three decisions, not one - and every one of them is
      // authorized, each under its own name. Falling out of the loop means
      // every resource was allowed or approved; stopping at the first refusal
      // means nothing runs.
      const touched =
        tool.resources === undefined
          ? [tool.resource(input, context)]
          : tool.resources(input, context);
      for (const resource of touched) {
        await observeOperation("tool", "tools.authorize", () => this.#kernel.authorize(
          tool.descriptor.id,
          call.scope,
          {
            resource,
            kind: tool.resourceKind,
            // Supplied so the kernel can offer "this project" as an approval scope
            // and, more importantly, so it can offer nothing above it.
            root: this.#sandbox.policy.workspaceRoot,
          },
          call.signal,
        ));
      }
      const resource = touched[0];
      // Permission is not containment. Approval says the user agreed; this says
      // we can actually hold the boundary. Both are required, and the sandbox
      // is asked second so an unapproved call is refused before we consider
      // whether we could have contained it.
      observeSynchronousOperation("tool", "tools.containment", () => this.#sandbox.assertSupports(tool.descriptor));

      if (call.signal?.aborted) {
        throw new ToolError("cancelled", {
          message: "The call was stopped before it started, so nothing was done.",
          tool: call.name,
        });
      }

      // Last, and here rather than in each tool. A tool that changes the
      // project is a tool that must be undoable, and that is a property of the
      // effects it declares — not something every author has to remember.
      // Placed after authorization so a refused call leaves no snapshot behind,
      // and before execution because a snapshot taken afterwards records the
      // damage instead of the state to return to.
      //
      // Asked of the effect table rather than tested for `write` here. Testing
      // for `write` is what let `shell` through: it declares `execute`, writes
      // anyway, and nothing noticed. `execute` earns a restore point for the
      // same reason it earns an approval — we did not choose the program, so we
      // cannot know what it touched. See `T-14`.
      const snapshots = this.#snapshots;
      if (snapshots && requiresUndoPoint(tool.descriptor)) {
        await observeOperation("tool", "tools.snapshot", () => snapshots.beforeWrite(
          resource,
          resource === undefined ? "none" : tool.resourceKind,
        ));
      }

      // Bounds wrap execution and nothing before it. Authorization can put a
      // question in front of a person, and a human deciding is not a call
      // running slowly — putting approval under the deadline would cancel
      // calls for the offence of being thought about.
      return await this.#bounds.run(tool.descriptor, call.signal, (signal) =>
        tool.execute(input, {
          ...context,
          signal,
          authorize: async (more, limits) => {
            await observeOperation("tool", "tools.authorize", () => this.#kernel.authorize(
              tool.descriptor.id,
              call.scope,
              {
                resource: more,
                kind: "command",
                root: this.#sandbox.policy.workspaceRoot,
                ...(limits?.maxDuration === undefined ? {} : { maxDuration: limits.maxDuration }),
              },
              signal,
            ));
          },
        }),
      );
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
