import { DurableObject } from "cloudflare:workers";
import type { ModelMessage } from "ai";
import type {
  ApprovalRequest,
  ContextPackage,
  ExecutionLimits,
  RunState,
  RunStatus,
  RuntimeEventPayloads,
  RuntimeEventType,
  StudioToolDescriptor,
  ToolPolicy,
} from "@studio/v2-contracts";
import type { RuntimeEnv } from "./env";
import type { RuntimeProfile } from "./profile";
import { ExecutionError } from "../system/errors";
import { SessionStore, type EventScope } from "../state/log";
import {
  runAgentLoop,
  type CheckpointData,
  type LoopObservation,
  type LoopResult,
} from "../agent/loop";
import {
  buildToolSet,
  wrapToolSet,
  type RegisteredTool,
  type ToolRuntime,
} from "../agent/tools";
import { ToolExecutionCoordinator } from "../agent/coordinator";
import { gatewayModel } from "../gateway/client";
import {
  WATCHDOG_INTERVAL_MS,
  canRetry,
  canTransition,
  isExecuting,
  isStalled,
  isTerminal,
  retryDelayMs,
} from "../agent/lifecycle";
import {
  broadcast,
  closeMessage,
  parseClientMessage,
  pongMessage,
  snapshotMessage,
} from "../streaming/events";

/**
 * The durable execution engine, shared by every Studio runtime (Execution,
 * Planner, Agent). Built on raw Durable Objects — decision locked 2026-07-11:
 *
 * - DO SQLite holds the append-only event log (source of truth), the RunState
 *   projection, step checkpoints, and the submission idempotency table
 *   (SessionStore).
 * - Events are appended to the log BEFORE being broadcast; WebSockets are a
 *   view, never the truth. Clients reconnect with their last seq and receive
 *   a snapshot plus replay.
 * - The DO's single-threaded execution is the duplicate-execution guard:
 *   every lifecycle transition goes through this class and lifecycle.ts,
 *   carries a reason, bumps `runVersion`, and is CAS-checked so stale
 *   commands are rejected.
 * - Alarms drive the watchdog: stalled-run detection, retry backoff, and
 *   continuation while no client is connected. Disconnect NEVER cancels.
 *
 * Runtimes specialize this base at exactly three points:
 * - `profile`      — consumer id + fallback prompt (static config).
 * - `gateTools()`  — narrow the exposed tool set (e.g. Planner = read-only).
 * - `finalize()`   — turn the loop's result into the run's output and persist
 *                    it (Execution stores the transcript; Planner stores a Plan).
 *
 * Everything else — the state machine, checkpoints, idempotency, approvals,
 * the external-tool relay, recovery, and the WebSocket protocol — is identical
 * across runtimes and lives here so a fix lands once.
 */
export abstract class RuntimeSession<E extends RuntimeEnv> extends DurableObject<E> {
  protected readonly store: SessionStore;
  protected readonly toolCoordinator = new ToolExecutionCoordinator();
  protected abortController: AbortController | null = null;
  /** In-memory waiters for pending approvals; the durable record is in SQLite. */
  protected readonly approvalWaiters = new Map<string, (approved: boolean) => void>();
  protected readonly externalToolWaiters = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();

  /** Static per-runtime config. Subclasses declare this. */
  protected abstract readonly profile: RuntimeProfile;

  constructor(ctx: DurableObjectState, env: E) {
    super(ctx, env);
    this.store = new SessionStore(ctx.storage.sql);
  }

  // ── runtime specialization hooks ───────────────────────────────────────

  /**
   * Runs at the start of every execution attempt (initial, retry, recovery),
   * before context is loaded and before the loop is configured. Subclasses
   * hydrate in-memory config here that the synchronous hooks below need — e.g.
   * the Agent Runtime loads its durable AgentDefinition. Default: no-op.
   */
  protected async beforeExecute(_run: RunState): Promise<void> {}

  /**
   * Narrow the tool set exposed to the loop. Default: expose everything Studio
   * Context supplied. Planner overrides this to strip write/destructive tools.
   */
  protected gateTools(tools: Record<string, RegisteredTool>): Record<string, RegisteredTool> {
    return tools;
  }

  /**
   * The system prompt for this attempt. Default: Studio Context's per-consumer
   * prompt when present, otherwise the profile fallback. A runtime overrides
   * this to impose its own framing (e.g. Planner demands structured output).
   */
  protected composeSystemPrompt(context: ContextPackage | null): string {
    return context?.runtime.systemPrompt ?? this.profile.fallbackSystemPrompt;
  }

  /**
   * Turn a finished loop result into the run's output string (used for the
   * `run.completed` event) and persist whatever this runtime produces. Default:
   * return the assistant text with no persistence. Must never throw — a
   * persistence failure should not fail an otherwise-completed run.
   */
  protected async finalize(_run: RunState, result: LoopResult): Promise<string> {
    return result.text;
  }

  // ── HTTP surface (shared protocol; workers forward to it) ───────────────

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.headers.get("Upgrade") === "websocket") {
        return this.openWebSocket(url, authenticatedUserId(request));
      }
      switch (`${request.method} ${url.pathname}`) {
        case "POST /start":
          return json(await this.start(await request.json(), authenticatedUserId(request)));
        case "GET /state":
          return json(this.state(authenticatedUserId(request)));
        case "POST /pause":
          return json(await this.pause(await readCommand(request), authenticatedUserId(request)));
        case "POST /resume":
          return json(await this.resume(await readCommand(request), authenticatedUserId(request)));
        case "POST /cancel":
          return json(await this.cancel(await readCommand(request), authenticatedUserId(request)));
        default: {
          const approval = url.pathname.match(/^\/approvals\/([^/]+)\/resolve$/);
          if (approval && request.method === "POST") {
            return json(
              await this.resolveApproval(approval[1], await request.json(), authenticatedUserId(request)),
            );
          }
          const external = url.pathname.match(/^\/external-tools\/([^/]+)\/resolve$/);
          if (external && request.method === "POST") {
            return json(await this.resolveExternalTool(external[1], await request.json(), authenticatedUserId(request)));
          }
          return json({ error: "not_found" }, 404);
        }
      }
    } catch (error) {
      if (error instanceof ExecutionError) {
        return json(
          { error: error.code, message: error.message },
          statusForError(error),
        );
      }
      return json({ error: "internal", message: describe(error) }, 500);
    }
  }

  // ── lifecycle ──────────────────────────────────────────────────────────

  private async start(body: {
    runId: string;
    userId: string;
    conversationId: string;
    branchId?: string;
    turnId?: string;
    idempotencyKey: string;
    request: string;
    modelId: string;
    limits?: ExecutionLimits;
  }, authUserId: string | null): Promise<RunState> {
    if (!authUserId || authUserId !== body.userId) {
      throw new ExecutionError("unauthorized", "Authenticated user does not own this run.");
    }
    if (!body.idempotencyKey) {
      throw new ExecutionError(
        "invalid_request",
        "Every submission requires an idempotencyKey.",
      );
    }
    // Duplicate send (HTTP retry, double click, retransmission) → same run.
    const owner = this.store.claimSubmission(body.idempotencyKey, body.runId);
    if (owner !== body.runId) {
      const existing = this.store.loadRun(owner);
      if (existing) return existing;
    }
    const active = this.store.activeRun();
    if (active) {
      throw new ExecutionError(
        "run_already_active",
        `Run ${active.runId} is ${active.status}; one active run per session.`,
      );
    }
    const now = new Date().toISOString();
    const run: RunState = {
      runId: body.runId,
      userId: body.userId,
      conversationId: body.conversationId,
      branchId: body.branchId ?? "main",
      turnId: body.turnId ?? crypto.randomUUID(),
      attemptId: crypto.randomUUID(),
      status: "queued",
      statusReason: "submission accepted",
      runVersion: 0,
      idempotencyKey: body.idempotencyKey,
      request: body.request,
      modelId: body.modelId,
      currentStep: 0,
      completedSteps: [],
      pendingSteps: [],
      activeToolCalls: [],
      completedToolCalls: [],
      retryAttempts: 0,
      limits: body.limits,
      usage: {
        modelSteps: 0,
        toolCalls: 0,
        consecutiveErrors: 0,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        startedAt: now,
      },
      location: "cloud",
      createdAt: now,
      updatedAt: now,
    };
    this.store.saveRun(run);
    await this.emit(run, "run.created", {
      userId: run.userId,
      branchId: run.branchId,
      request: run.request,
      modelId: run.modelId,
    });
    await this.transition(run, "starting", "execution scheduled");
    await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_INTERVAL_MS);
    this.ctx.waitUntil(this.execute(run));
    return run;
  }

  private state(authUserId: string | null): { run: RunState | null } {
    const run = this.store.activeRun();
    if (run && run.userId !== authUserId) {
      throw new ExecutionError("forbidden", "Authenticated user does not own this conversation.");
    }
    return { run: run ?? null };
  }

  private async pause(cmd: Command, authUserId: string | null): Promise<RunState> {
    const run = this.requireActive(cmd, authUserId);
    await this.transition(run, "pausing", "pause requested");
    this.releaseApprovalWaiters(false);
    if (this.abortController) {
      this.abortController.abort("paused");
    } else {
      // No loop in memory (e.g. waiting on a retry alarm) — settle now.
      await this.transition(run, "paused", "no loop in flight");
    }
    return run;
  }

  private async resume(cmd: Command, authUserId: string | null): Promise<RunState> {
    const run = this.requireActive(cmd, authUserId);
    await this.transition(run, "recovering", "resume requested");
    await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_INTERVAL_MS);
    this.ctx.waitUntil(this.execute(run));
    return run;
  }

  private async cancel(cmd: Command, authUserId: string | null): Promise<RunState> {
    const run = this.requireActive(cmd, authUserId);
    await this.transition(run, "cancelling", "cancel requested");
    this.releaseApprovalWaiters(false);
    if (this.abortController) {
      this.abortController.abort("cancelled");
    } else {
      await this.transition(run, "cancelled", "no loop in flight");
    }
    return run;
  }

  private requireActive(cmd?: Command, authUserId?: string | null): RunState {
    const run = this.store.activeRun();
    if (!run) throw new ExecutionError("run_not_found", "No active run.");
    if (!authUserId || run.userId !== authUserId) {
      throw new ExecutionError("forbidden", "Authenticated user does not own this conversation.");
    }
    // Compare-and-swap: a command built against an older view of the run
    // (another tab, a delayed retry) must not act on the current one.
    if (cmd?.expectedVersion !== undefined && cmd.expectedVersion !== run.runVersion) {
      throw new ExecutionError(
        "stale_command",
        `Command expected run version ${cmd.expectedVersion}, current is ${run.runVersion}.`,
      );
    }
    return run;
  }

  /** The only way a run's status changes. Illegal transitions throw. */
  private async transition(run: RunState, to: RunStatus, reason: string): Promise<void> {
    if (!canTransition(run.status, to)) {
      throw new ExecutionError(
        "illegal_transition",
        `Illegal transition ${run.status} → ${to} (${reason}).`,
      );
    }
    const previous = run.status;
    run.status = to;
    run.statusReason = reason;
    run.runVersion += 1;
    run.updatedAt = new Date().toISOString();
    this.store.saveRun(run);
    await this.emit(run, "run.status_changed", {
      previousStatus: previous,
      nextStatus: to,
      runVersion: run.runVersion,
      reason,
    });
    if (to === "recovering") {
      await this.emit(run, "run.recovering", {
        attempt: run.retryAttempts,
        reason,
      });
    } else if (to === "cancelled") {
      await this.emit(run, "run.cancelled", { reason });
    }
  }

  /**
   * Lenient variant for the loop's phase reports: the model interleaves
   * reasoning, tool use, and text freely, and a pause/cancel intent may have
   * landed meanwhile — redundant or illegal phase reports are simply ignored.
   */
  private async phase(runId: string, to: RunStatus): Promise<void> {
    const run = this.store.loadRun(runId);
    if (!run || !canTransition(run.status, to)) return;
    await this.transition(run, to, "loop phase");
  }

  // ── execution ──────────────────────────────────────────────────────────

  private async execute(run: RunState): Promise<void> {
    this.abortController = new AbortController();
    // Every execution attempt (initial, retry, recovery) gets its own id.
    run.attemptId = crypto.randomUUID();
    this.store.saveRun(run);
    await this.emit(run, "run.started", { attemptId: run.attemptId });
    try {
      await this.beforeExecute(run);
      const context = await this.loadContext(run);
      const messages = this.restoreMessages(run, context);
      // Persist intent BEFORE the model call: if this attempt dies before
      // its first step completes, recovery still knows exactly where it was.
      await this.checkpoint(run, {
        nextStepNumber: run.currentStep + 1,
        messages,
        partialAssistantText: "",
        completedToolCallIds: [],
        pendingToolCallIds: [],
      });
      const registered = context
        ? buildToolSet(context, this.env.MCP, (id, descriptor, input) =>
            this.requestExternalTool(run, id, descriptor, input),
          )
        : {};
      const result = await runAgentLoop(
        {
          runId: run.runId,
          attemptId: run.attemptId,
          model: gatewayModel(this.env.GATEWAY, run.modelId),
          system: this.composeSystemPrompt(context),
          messages,
          // The wrapper (idempotency + approval + limits) is always in force;
          // gateTools() lets a runtime narrow what is exposed first.
          tools: wrapToolSet(this.gateTools(registered), this.toolRuntime(run)),
          limits: context?.runtime.limits ?? run.limits,
          abortSignal: this.abortController.signal,
        },
        {
          emit: (type, payload) => this.emit(run, type, payload),
          checkpoint: (data) => this.checkpoint(run, data),
          phase: (status) => this.phase(run.runId, status),
          observe: (event) => this.observe(run.runId, event),
        },
      );
      const current = this.store.loadRun(run.runId);
      if (current && isExecuting(current.status)) {
        const output = await this.finalize(current, result);
        await this.emit(current, "run.completed", { output });
        await this.transition(current, "completed", "run finished");
      }
    } catch (error) {
      await this.handleExecutionError(run.runId, error);
    } finally {
      this.abortController = null;
    }
  }

  private async handleExecutionError(runId: string, error: unknown): Promise<void> {
    const run = this.store.loadRun(runId);
    if (!run || isTerminal(run.status) || run.status === "paused") {
      return; // Already settled elsewhere.
    }
    if (run.status === "pausing") {
      await this.transition(run, "paused", "loop stopped after pause");
      return;
    }
    if (run.status === "cancelling") {
      await this.transition(run, "cancelled", "loop stopped after cancel");
      return;
    }
    if (canRetry(run)) {
      run.retryAttempts += 1;
      this.store.saveRun(run);
      await this.transition(
        run,
        "recovering",
        `retry ${run.retryAttempts} scheduled: ${describe(error)}`,
      );
      await this.ctx.storage.setAlarm(Date.now() + retryDelayMs(run.retryAttempts));
      return;
    }
    const failureSummary = `Run failed after ${run.retryAttempts} retries: ${describe(error)}`;
    await this.emit(run, "run.failed", { failureSummary });
    run.failureSummary = failureSummary;
    await this.transition(run, "failed", failureSummary);
  }

  /** POST a JSON body to Studio Data (used by subclass finalize hooks). */
  protected async postData(path: string, userId: string, body: unknown): Promise<void> {
    const response = await this.env.DATA.fetch(`https://data${path}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": userId,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Studio Data ${path} returned ${response.status}`);
    }
  }

  // ── tool boundary: idempotency + approvals ─────────────────────────────

  private toolRuntime(run: RunState): ToolRuntime {
    return {
      runId: run.runId,
      coordinator: this.toolCoordinator,
      reserve: (toolCallId) => this.store.reserveOperation(run.runId, toolCallId),
      mark: (toolCallId, status, result) =>
        this.store.markOperation(`${run.runId}:${toolCallId}`, status, result),
      requestApproval: (toolCallId, toolName, input, policy) =>
        this.requestApproval(run, toolCallId, toolName, input, policy),
    };
  }

  /**
   * Park the run at the permission boundary. The runtime never decides —
   * it persists the request, broadcasts `approval.required`, and waits for
   * the frontend's single resolution (which survives DO restarts: a
   * recovered run re-requests and finds the durable verdict).
   */
  private async requestApproval(
    run: RunState,
    toolCallId: string,
    toolName: string,
    input: unknown,
    policy: ToolPolicy,
  ): Promise<boolean> {
    const approvalId = `apr_${toolCallId}`;
    const existing = this.store.loadApproval(approvalId);
    if (existing?.status === "approved") return true;
    if (existing?.status === "denied" || existing?.status === "expired") return false;

    if (!existing) {
      const approval: ApprovalRequest = {
        approvalId,
        runId: run.runId,
        toolCallId,
        toolName,
        summarizedAction: `${toolName} (${policy.effect})`,
        normalizedInput: input,
        riskLevel: policy.effect === "destructive" ? "high" : policy.effect === "write" ? "medium" : "low",
        status: "pending",
        createdAt: new Date().toISOString(),
      };
      this.store.saveApproval(approval);
      await this.emit(run, "approval.required", {
        approvalId,
        toolCallId,
        toolName,
        summarizedAction: approval.summarizedAction,
        riskLevel: approval.riskLevel,
      });
    }
    await this.phase(run.runId, "waiting_for_approval");
    return new Promise<boolean>((resolve) => {
      this.approvalWaiters.set(approvalId, resolve);
    });
  }

  private async requestExternalTool(
    run: RunState,
    toolCallId: string,
    descriptor: StudioToolDescriptor,
    input: unknown,
  ): Promise<unknown> {
    const existing = this.store.loadExternalCall(toolCallId);
    if (existing?.status === "completed") return existing.result;
    if (existing?.status === "failed") throw new Error(existing.error ?? "Local tool failed.");
    if (!existing) {
      if (descriptor.route.kind !== "local-relay") throw new Error("Invalid local tool route.");
      this.store.saveExternalCall(run.runId, toolCallId, descriptor.route.serverId, descriptor.route.toolName, input);
      await this.emit(run, "tool.external_requested", { toolCallId, serverId: descriptor.route.localRegistrationId ?? descriptor.route.serverId, toolName: descriptor.route.toolName, input });
    }
    await this.phase(run.runId, "waiting_for_external_result");
    return new Promise((resolve, reject) => this.externalToolWaiters.set(toolCallId, { resolve, reject }));
  }

  private async resolveExternalTool(
    toolCallId: string,
    body: { result?: unknown; error?: string },
    userId: string | null,
  ): Promise<{ resolved: boolean }> {
    const run = this.store.activeRun();
    if (!run || !userId || run.userId !== userId) throw new ExecutionError("forbidden", "Authenticated user does not own this tool call.");
    const pending = this.store.loadExternalCall(toolCallId);
    if (!pending) throw new ExecutionError("invalid_request", "External tool call not found.");
    if (pending.status !== "pending") return { resolved: true };
    this.store.resolveExternalCall(toolCallId, body.result, body.error);
    this.store.markOperation(
      `${run.runId}:${toolCallId}`,
      body.error ? "failed" : "completed",
      body.error ? undefined : JSON.stringify(body.result ?? null),
    );
    await this.emit(run, "tool.external_resolved", { toolCallId });
    await this.phase(run.runId, "tools_running");
    const waiter = this.externalToolWaiters.get(toolCallId);
    this.externalToolWaiters.delete(toolCallId);
    if (waiter) body.error ? waiter.reject(new Error(body.error)) : waiter.resolve(body.result);
    else if (!this.abortController) this.ctx.waitUntil(this.execute(run));
    return { resolved: true };
  }

  /**
   * Unpark any loop waiting at an approval so pause/cancel can unwind it.
   * The durable approval record stays pending — a resumed run re-asks.
   */
  private releaseApprovalWaiters(approved: boolean): void {
    for (const [id, waiter] of this.approvalWaiters) {
      this.approvalWaiters.delete(id);
      waiter(approved);
    }
  }

  /** Exactly one resolution per approval; duplicates are rejected. */
  private async resolveApproval(
    approvalId: string,
    body: { approved: boolean; resolvedBy?: string },
    authUserId: string | null,
  ): Promise<ApprovalRequest> {
    const approval = this.store.loadApproval(approvalId);
    if (!approval) {
      throw new ExecutionError("approval_not_found", `No approval ${approvalId}.`);
    }
    if (approval.status !== "pending") {
      throw new ExecutionError(
        "approval_already_resolved",
        `Approval ${approvalId} is already ${approval.status}.`,
      );
    }
    approval.status = body.approved ? "approved" : "denied";
    approval.resolvedBy = body.resolvedBy;
    approval.resolvedAt = new Date().toISOString();
    this.store.saveApproval(approval);

    const run = this.store.loadRun(approval.runId);
    if (!authUserId || (run && run.userId !== authUserId)) {
      throw new ExecutionError("forbidden", "Authenticated user does not own this approval.");
    }
    if (run) {
      await this.emit(run, "approval.resolved", {
        approvalId,
        approved: body.approved,
      });
      await this.phase(run.runId, "tools_running");
    }
    const waiter = this.approvalWaiters.get(approvalId);
    this.approvalWaiters.delete(approvalId);
    if (waiter) {
      waiter(body.approved);
    } else if (run && !isTerminal(run.status) && !this.abortController) {
      // The DO restarted while parked at this approval: restart the loop.
      // Recovery re-reserves the tool call, finds the durable verdict just
      // written, and proceeds without re-asking.
      this.ctx.waitUntil(this.execute(run));
    }
    return approval;
  }

  /** Resume from the latest checkpoint, or seed from the original request. */
  private restoreMessages(run: RunState, context: ContextPackage | null): ModelMessage[] {
    const latest = this.store.latestCheckpoint(run.runId);
    if (latest) {
      run.currentStep = latest.checkpoint.nextStepNumber - 1;
      return JSON.parse(latest.messagesJson) as ModelMessage[];
    }
    const history = context?.conversation.relevantHistory.map((m) => ({
      role: m.role,
      content: m.content,
    })) as ModelMessage[] | undefined;
    return [...(history ?? []), { role: "user", content: run.request }];
  }

  private async loadContext(run: RunState): Promise<ContextPackage | null> {
    const response = await this.env.CONTEXT.fetch("https://context/context", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-user-id": run.userId,
      },
      body: JSON.stringify({
        userId: run.userId,
        taskId: run.turnId,
        conversationId: run.conversationId,
        task: run.request,
        consumer: this.profile.consumer,
      }),
    });
    if (response.status === 501 || response.status === 404) return null;
    if (!response.ok) {
      throw new ExecutionError(
        "context_unavailable",
        `Studio Context failed with ${response.status}.`,
        true,
      );
    }
    return (await response.json()) as ContextPackage;
  }

  private async observe(runId: string, event: LoopObservation): Promise<void> {
    const run = this.store.loadRun(runId);
    if (!run) return;
    const limits = run.limits ?? {};
    if (event.type === "model_step") {
      run.usage.modelSteps += 1;
      run.usage.inputTokens += event.inputTokens;
      run.usage.outputTokens += event.outputTokens;
      run.usage.totalTokens += event.totalTokens;
    } else {
      run.usage.toolCalls += 1;
      const repeated = this.store.recordToolSignature(
        run.runId,
        event.toolName,
        stableStringify(event.input),
      );
      if (limits.maxRepeatedToolCalls !== undefined && repeated > limits.maxRepeatedToolCalls) {
        throw new ExecutionError(
          "repeated_tool_cycle",
          `Repeated tool call cycle detected for ${event.toolName}.`,
        );
      }
    }
    run.updatedAt = new Date().toISOString();
    this.store.saveRun(run);
    this.enforceLimits(run);
  }

  private enforceLimits(run: RunState): void {
    const limits = run.limits ?? {};
    const usage = run.usage;
    const elapsedMs = Date.now() - new Date(usage.startedAt).getTime();
    const checks: Array<[number | undefined, number, string]> = [
      [limits.maxModelSteps, usage.modelSteps, "model step limit reached"],
      [limits.maxToolCalls, usage.toolCalls, "tool call limit reached"],
      [limits.maxWallClockMs, elapsedMs, "wall-clock limit reached"],
      [limits.maxConsecutiveErrors, usage.consecutiveErrors, "consecutive error limit reached"],
      [limits.maxInputTokens, usage.inputTokens, "input token limit reached"],
      [limits.maxOutputTokens, usage.outputTokens, "output token limit reached"],
      [limits.maxTotalTokens, usage.totalTokens, "total token limit reached"],
    ];
    for (const [limit, actual, message] of checks) {
      if (limit !== undefined && actual > limit) {
        throw new ExecutionError("execution_limit_reached", message);
      }
    }
  }

  private async checkpoint(run: RunState, data: CheckpointData): Promise<void> {
    const current = this.store.loadRun(run.runId) ?? run;
    const checkpoint = await this.store.saveCheckpoint(
      run.runId,
      {
        status: current.status,
        nextStepNumber: data.nextStepNumber,
        completedToolCallIds: data.completedToolCallIds,
        pendingToolCallIds: data.pendingToolCallIds,
        partialAssistantText: data.partialAssistantText || undefined,
      },
      JSON.stringify(data.messages),
    );
    current.currentStep = data.nextStepNumber - 1;
    current.lastCheckpointId = checkpoint.checkpointId;
    current.updatedAt = new Date().toISOString();
    this.store.saveRun(current);
  }

  // ── watchdog ───────────────────────────────────────────────────────────

  async alarm(): Promise<void> {
    const run = this.store.activeRun();
    if (!run) return;
    if (run.status === "paused") return; // Wait for explicit resume.

    if (isExecuting(run.status) && !this.abortController) {
      // The loop isn't in memory (DO restarted, or a retry alarm fired):
      // continue from the latest checkpoint.
      this.ctx.waitUntil(this.execute(run));
    } else if (
      (run.status === "pausing" || run.status === "cancelling") &&
      !this.abortController
    ) {
      // Intent state left dangling by an eviction — settle it.
      await this.transition(
        run,
        run.status === "pausing" ? "paused" : "cancelled",
        "settled by watchdog after restart",
      );
    } else if (isStalled(run, new Date())) {
      this.abortController?.abort("stalled");
      await this.handleExecutionError(
        run.runId,
        new ExecutionError("provider_failure", "Run stalled: no progress within the stall timeout.", true),
      );
    }
    const still = this.store.activeRun();
    if (still && !isTerminal(still.status) && still.status !== "paused") {
      await this.ctx.storage.setAlarm(Date.now() + WATCHDOG_INTERVAL_MS);
    }
  }

  // ── streaming (views over the log) ─────────────────────────────────────

  private openWebSocket(url: URL, authUserId = url.searchParams.get("userId")): Response {
    const run = this.store.activeRun();
    if (!authUserId || (run && run.userId !== authUserId)) {
      return json({ error: "forbidden" }, 403);
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server);

    // Legacy convenience: ?lastSeq= subscribes immediately. Protocol clients
    // send a `subscribe` frame instead (handled in webSocketMessage).
    const lastSeq = url.searchParams.get("lastSeq");
    if (lastSeq !== null) {
      this.subscribe(server, Number(lastSeq));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  /** Snapshot + replay everything after the client's last processed seq. */
  private subscribe(ws: WebSocket, lastReceivedSequence: number): void {
    const run = this.store.activeRun();
    ws.send(snapshotMessage(run, this.store.latestSequence()));
    for (const event of this.store.eventsSince(lastReceivedSequence)) {
      ws.send(JSON.stringify(event));
    }
  }

  async webSocketMessage(ws: WebSocket, message: ArrayBuffer | string): Promise<void> {
    // The socket is a subscription; control goes through the HTTP surface.
    const msg = parseClientMessage(message);
    if (!msg) return;
    switch (msg.type) {
      case "subscribe":
        this.subscribe(ws, msg.lastReceivedSequence);
        break;
      case "ack":
        // Survives hibernation with the socket; feeds future gap detection.
        ws.serializeAttachment({ lastAck: msg.sequence });
        break;
      case "ping":
        ws.send(pongMessage());
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    ws.close();
  }

  /** Log first, broadcast second: the log stays authoritative. */
  protected async emit<T extends RuntimeEventType>(
    scope: EventScope,
    type: T,
    payload: RuntimeEventPayloads[T],
  ): Promise<void> {
    const event = this.store.appendEvent(scope, type, payload);
    broadcast(this.ctx.getWebSockets(), event);
    if (type === "run.completed" || type === "run.failed" || type === "run.cancelled") {
      for (const ws of this.ctx.getWebSockets()) {
        ws.send(closeMessage(type));
      }
    }
  }
}

/** Optional CAS payload on control commands. */
interface Command {
  expectedVersion?: number;
}

async function readCommand(request: Request): Promise<Command> {
  try {
    return (await request.json()) as Command;
  } catch {
    return {};
  }
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

function statusForError(error: ExecutionError): number {
  switch (error.code) {
    case "unauthorized":
      return 401;
    case "forbidden":
      return 403;
    case "run_not_found":
    case "approval_not_found":
      return 404;
    default:
      return 409;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function authenticatedUserId(request: Request): string | null {
  return request.headers.get("x-user-id") ?? request.headers.get("X-User-ID");
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortForStableStringify(value));
}

function sortForStableStringify(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortForStableStringify);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, sortForStableStringify(item)]),
  );
}
