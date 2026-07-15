import type { ContextPackage, ExecutionLimits, RunState, StudioToolDescriptor, ToolEffect } from "../contracts";
import { runModelLoop } from "./modelLoop";

export interface RuntimeEnv {
  GATEWAY: Fetcher;
  CONTEXT: Fetcher;
  DATA: Fetcher;
  MCP: Fetcher;
  TOOL_POOL: Fetcher;
  TOOL_EXECUTION: Fetcher;
}

export interface RuntimeProfile {
  consumer: "execution" | "planner" | "agent";
  fallbackSystemPrompt: string;
}

export interface LoopResult {
  text: string;
}

export interface RegisteredTool {
  descriptor: StudioToolDescriptor;
  policy: {
    effect: ToolEffect;
    requiresApproval: boolean;
  };
}

export interface ToolExecutionResult {
  ok: boolean;
  jobId?: string;
  toolCallId?: string;
  toolName?: string;
  status?: string;
  result?: unknown;
  error?: unknown;
  artifacts?: RuntimeArtifactRef[];
  permissionRequest?: RuntimePermissionRequest;
}

interface RuntimeArtifactRef {
  artifactId: string;
  artifactVersionId?: string;
  eventId?: string;
  status?: string;
  title?: string;
}

interface RuntimePermissionRequest {
  permissionRequestId: string;
  artifactId: string;
  reason: string;
}

interface RuntimeEvent {
  format: "studio.runtime.event.v1";
  eventId: string;
  runId: string;
  sequence: number;
  type: string;
  visibility: "renderable" | "model" | "internal" | "audit";
  timestamp: string;
  payload: Record<string, unknown>;
}

interface StartBody {
  conversationId: string;
  userId: string;
  workspaceId?: string;
  agentId?: string;
  request: string;
  modelId: string;
  idempotencyKey: string;
  branchId?: string;
  turnId?: string;
  runId?: string;
  limits?: ExecutionLimits;
}

interface RuntimeToolCallBody {
  toolName: string;
  arguments?: Record<string, unknown>;
  toolCallId?: string;
}

interface ArtifactProposal {
  presentation_intent?: string;
  title?: string;
  summary?: string;
  activity_label?: string;
  body?: string;
  fields?: Record<string, unknown>;
  requires_permission?: boolean;
}

const RUN_KEY = "run:current";
const EVENTS_KEY = "run:events";
const ACTIVE_TOOLS_KEY = "run:active-tools";

export abstract class RuntimeSession<Env extends RuntimeEnv> {
  protected readonly ctx: DurableObjectState;
  protected readonly env: Env;
  protected abstract readonly profile: RuntimeProfile;
  private cachedEvents: RuntimeEvent[] = [];
  private readonly sockets = new Set<WebSocket>();

  constructor(ctx: DurableObjectState, env: Env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const userId = request.headers.get("x-user-id") ?? request.headers.get("X-User-ID");
    if (!userId) return Response.json({ error: "unauthorized" }, { status: 401 });

    if (request.method === "POST" && url.pathname === "/start") {
      const body = (await request.json()) as StartBody;
      if (body.userId !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
      return this.start(body);
    }
    if (request.method === "GET" && url.pathname === "/state") {
      const run = await this.ctx.storage.get<RunState>(RUN_KEY);
      if (run && run.userId !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
      return Response.json({ run: run ?? null }, { status: run ? 200 : 404 });
    }
    if (request.method === "GET" && url.pathname === "/events") {
      return this.eventsResponse(userId, Number(url.searchParams.get("after") ?? url.searchParams.get("lastSeq") ?? 0));
    }
    if (request.method === "GET" && url.pathname === "/ws") {
      return this.websocketResponse(request, userId, Number(url.searchParams.get("lastSeq") ?? 0));
    }
    if (request.method === "POST" && ["/pause", "/resume", "/cancel"].includes(url.pathname)) {
      return this.transition(userId, url.pathname.slice(1) as "pause" | "resume" | "cancel");
    }
    if (request.method === "POST" && url.pathname === "/tools/execute") {
      return this.executeRequestedTool(await request.json());
    }
    if (request.method === "POST" && url.pathname === "/tools/execute/batch") {
      return this.executeRequestedTools(await request.json());
    }
    if (request.method === "POST" && url.pathname.startsWith("/approvals/") && url.pathname.endsWith("/resolve")) {
      return this.resolveApproval(userId, url.pathname.split("/")[2], await request.json());
    }
    if (request.method === "POST" && (url.pathname.startsWith("/external-tools/") || url.pathname.startsWith("/client-actions/"))) {
      return this.acceptExternalResolution(userId, url.pathname, await request.json());
    }
    return Response.json({ error: "not_found" }, { status: 404 });
  }

  protected async beforeExecute(): Promise<void> {}

  protected composeSystemPrompt(context: ContextPackage | null): string {
    return [
      context?.runtime.systemPrompt ?? this.profile.fallbackSystemPrompt,
      context?.runtime.instructions.filter(Boolean).join("\n\n"),
    ].filter(Boolean).join("\n\n");
  }

  protected gateTools(tools: Record<string, RegisteredTool>): Record<string, RegisteredTool> {
    return tools;
  }

  protected async finalize(_run: RunState, result: LoopResult): Promise<string> {
    return result.text;
  }

  protected async emit(run: RunState, type: string, payload: Record<string, unknown>): Promise<void> {
    const events = await this.readEvents();
    const event: RuntimeEvent = {
      format: "studio.runtime.event.v1",
      eventId: crypto.randomUUID(),
      runId: run.runId,
      sequence: events.length + 1,
      type,
      visibility: visibilityForRuntimeEvent(type),
      timestamp: new Date().toISOString(),
      payload,
    };
    events.push(event);
    await this.ctx.storage.put(EVENTS_KEY, events);
    this.broadcast(event);
    await this.persistConversationEvent(run, type, payload);
  }

  protected eventsForRun(runId: string): RuntimeEvent[] {
    return this.cachedEvents.filter((event) => event.runId === runId);
  }

  protected async postData(path: string, userId: string, body: unknown): Promise<Response> {
    return this.env.DATA.fetch(`https://data${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": userId },
      body: JSON.stringify(body),
    });
  }

  private async persistConversationEvent(run: RunState, type: string, payload: Record<string, unknown>): Promise<void> {
    const event = transcriptEventFor(this.profile.consumer, run, type, payload);
    if (!event) return;
    try {
      const response = await this.postData("/transcripts/events", run.userId, event);
      if (!response.ok) console.warn(`Transcript persistence failed (${response.status}) for ${type}.`);
    } catch (error) {
      console.warn("Transcript persistence failed", error);
    }
  }

  protected async executeToolCall(run: RunState, tool: RegisteredTool, args: Record<string, unknown>, toolCallId: string = crypto.randomUUID()): Promise<ToolExecutionResult> {
    if (!tool.descriptor.route) {
      return { ok: false, toolCallId, toolName: tool.descriptor.name, status: "failed", error: { code: "missing_tool_route", message: "Tool descriptor does not include an execution route." } };
    }
    if (tool.descriptor.route.kind === "client") {
      return this.executeClientTool(run, tool, args, toolCallId);
    }
    if (requiresRuntimeApproval(tool)) {
      return this.createPermissionRequiredResult(run, tool, args, toolCallId);
    }
    const payload = {
      format: "studio.tool-execution.request.v1",
      userId: run.userId,
      workspaceId: run.workspaceId,
      sessionId: run.runId,
      conversationId: run.conversationId,
      agentId: run.agentId,
      agentExecutionId: this.profile.consumer === "agent" ? run.runId : undefined,
      toolCallId,
      toolName: tool.descriptor.name,
      arguments: args,
      tool: tool.descriptor,
      route: tool.descriptor.route,
      sourceRuntime: this.profile.consumer,
      idempotencyKey: `${run.runId}:${toolCallId}`,
    };
    await this.emit(run, "tool.call.started", { toolCallId, toolName: tool.descriptor.name });
    const response = await this.env.TOOL_EXECUTION.fetch("https://tool-execution/execute", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": run.userId },
      body: JSON.stringify(payload),
    });
    const result = await readJson<ToolExecutionResult>(response);
    if (result.ok) {
      const artifact = await this.createCompletedArtifactFromResult(run, tool, args, toolCallId, result.result);
      if (artifact) result.artifacts = [...(result.artifacts ?? []), artifact];
    }
    await this.emit(run, result.ok ? "tool.call.completed" : "tool.call.failed", { toolCallId, toolName: tool.descriptor.name, result });
    await this.emitArtifactRefs(run, result.artifacts, result.ok ? "completed" : "failed");
    return result;
  }

  protected async executeToolCalls(run: RunState, calls: Array<{ tool: RegisteredTool; args: Record<string, unknown>; toolCallId?: string }>): Promise<ToolExecutionResult[]> {
    const payload = {
      userId: run.userId,
      sourceRuntime: this.profile.consumer,
      workspaceId: run.workspaceId,
      sessionId: run.runId,
      conversationId: run.conversationId,
      agentId: run.agentId,
      agentExecutionId: this.profile.consumer === "agent" ? run.runId : undefined,
      calls: calls.map((call) => ({
        toolCallId: call.toolCallId ?? crypto.randomUUID(),
        toolName: call.tool.descriptor.name,
        arguments: call.args,
        tool: call.tool.descriptor,
        route: call.tool.descriptor.route,
      })),
    };
    const response = await this.env.TOOL_EXECUTION.fetch("https://tool-execution/execute/batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": run.userId },
      body: JSON.stringify(payload),
    });
    const body = await readJson<{ results?: ToolExecutionResult[] }>(response);
    const results = body.results ?? [];
    for (const [index, result] of results.entries()) {
      if (result.ok) {
        const call = calls[index];
        if (call) {
          const artifact = await this.createCompletedArtifactFromResult(run, call.tool, call.args, result.toolCallId, result.result);
          if (artifact) result.artifacts = [...(result.artifacts ?? []), artifact];
        }
      }
      await this.emitArtifactRefs(run, result.artifacts, result.ok ? "completed" : "failed");
    }
    return results;
  }

  private async createPermissionRequiredResult(run: RunState, tool: RegisteredTool, args: Record<string, unknown>, toolCallId: string): Promise<ToolExecutionResult> {
    const permissionRequestId = `perm_${crypto.randomUUID()}`;
    const proposal = readArtifactProposal(args.__studioArtifactProposal);
    const artifact = await this.createRuntimeArtifact(run, {
      tool,
      args,
      toolCallId,
      permissionRequestId,
      status: "awaiting_permission",
      proposal,
    });
    await this.emit(run, "artifact.permission.requested", {
      artifactId: artifact.artifactId,
      artifactVersionId: artifact.artifactVersionId,
      permissionRequestId,
      toolCallId,
      toolName: tool.descriptor.name,
      title: artifact.title,
    });
    return {
      ok: false,
      toolCallId,
      toolName: tool.descriptor.name,
      status: "waiting_for_permission",
      error: {
        code: "permission_required",
        message: "This tool call requires user approval before execution.",
        retryable: false,
      },
      artifacts: [artifact],
      permissionRequest: {
        permissionRequestId,
        artifactId: artifact.artifactId,
        reason: `Approval required for ${tool.descriptor.name}.`,
      },
    };
  }

  private async createRuntimeArtifact(run: RunState, input: {
    tool: RegisteredTool;
    args: Record<string, unknown>;
    toolCallId: string;
    permissionRequestId?: string;
    status: "planned" | "awaiting_permission" | "running" | "completed" | "failed" | "partial";
    proposal?: ArtifactProposal;
  }): Promise<RuntimeArtifactRef> {
    const family = artifactFamilyFor(input.tool, input.proposal);
    const title = safeTitle(input.proposal?.title, input.tool.descriptor.description || input.tool.descriptor.name);
    const response = await this.postData("/artifacts", run.userId, {
      conversationId: run.conversationId,
      turnId: run.turnId,
      executionId: run.runId,
      toolCallId: input.toolCallId,
      permissionRequestId: input.permissionRequestId,
      family,
      type: artifactTypeFor(input.tool),
      status: input.status,
      visibility: "user_visible",
      title,
      summary: input.proposal?.summary ?? input.proposal?.body ?? `Prepared ${input.tool.descriptor.name}.`,
      modelPresentation: {
        title,
        summary: input.proposal?.summary,
        body: input.proposal?.body,
        fields: input.proposal?.fields ?? {},
        presentationIntent: input.proposal?.presentation_intent,
      },
      runtimeData: {
        runtime: this.profile.consumer,
        runId: run.runId,
        toolName: input.tool.descriptor.name,
        toolRoute: input.tool.descriptor.route,
        toolEffect: input.tool.policy.effect,
        requiresApproval: input.tool.policy.requiresApproval,
      },
      placement: { turnId: run.turnId, toolCallId: input.toolCallId },
      idempotencyKey: `${run.runId}:${input.toolCallId}:${input.status}`,
    });
    const body = await readJson<{ id?: string; currentVersionId?: string; current?: { id?: string }; title?: string; status?: string }>(response);
    if (!response.ok || typeof body.id !== "string") throw new Error(`Artifact creation failed for ${input.tool.descriptor.name}.`);
    return {
      artifactId: body.id,
      artifactVersionId: body.currentVersionId ?? body.current?.id,
      status: body.status,
      title: body.title ?? title,
    };
  }

  private async createCompletedArtifactFromResult(
    run: RunState,
    tool: RegisteredTool,
    args: Record<string, unknown>,
    toolCallId: string,
    result: unknown,
  ): Promise<RuntimeArtifactRef | undefined> {
    const proposal = readArtifactProposalFromResult(result);
    if (!proposal) return undefined;
    return this.createRuntimeArtifact(run, {
      tool,
      args,
      toolCallId,
      status: "completed",
      proposal,
    });
  }

  private async emitArtifactRefs(run: RunState, artifacts: RuntimeArtifactRef[] | undefined, status: "completed" | "failed"): Promise<void> {
    for (const artifact of artifacts ?? []) {
      await this.emit(run, status === "completed" ? "artifact.completed" : "artifact.failed", {
        artifactId: artifact.artifactId,
        artifactVersionId: artifact.artifactVersionId,
        status: artifact.status ?? status,
        title: artifact.title,
      });
    }
  }

  private async executeRequestedTool(body: unknown): Promise<Response> {
    try {
      const run = await this.requireActiveRun();
      const call = readToolCall(body);
      const tool = await this.requireVisibleTool(run, call.toolName);
      const result = await this.executeToolCall(run, tool, call.arguments ?? {}, call.toolCallId);
      return Response.json(result, { status: result.ok ? 200 : 502 });
    } catch (error) {
      return Response.json({ ok: false, error: describe(error) }, { status: 400 });
    }
  }

  private async executeRequestedTools(body: unknown): Promise<Response> {
    try {
      const run = await this.requireActiveRun();
      const input = readObject(body);
      const rawCalls = input.calls;
      if (!Array.isArray(rawCalls) || rawCalls.length < 1 || rawCalls.length > 20) {
        return Response.json({ error: "invalid_request", message: "calls must contain between 1 and 20 tool calls." }, { status: 400 });
      }
      const tools = await this.visibleTools(run);
      const calls = rawCalls.map((raw) => {
        const call = readToolCall(raw);
        const tool = tools[call.toolName];
        if (!tool) throw new Error(`Tool ${call.toolName} is not available in this runtime context.`);
        return { tool, args: call.arguments ?? {}, toolCallId: call.toolCallId };
      });
      const results = await this.executeToolCalls(run, calls);
      return Response.json({ ok: results.every((result) => result.ok), results });
    } catch (error) {
      return Response.json({ ok: false, error: describe(error) }, { status: 400 });
    }
  }

  private async start(body: StartBody): Promise<Response> {
    const now = new Date().toISOString();
    const existing = await this.ctx.storage.get<RunState>(RUN_KEY);
    if (existing?.idempotencyKey === body.idempotencyKey) return Response.json({ run: existing });

    const run: RunState = {
      runId: body.runId ?? crypto.randomUUID(),
      conversationId: body.conversationId,
      userId: body.userId,
      workspaceId: body.workspaceId,
      agentId: body.agentId,
      request: body.request,
      modelId: body.modelId,
      idempotencyKey: body.idempotencyKey,
      branchId: body.branchId,
      turnId: body.turnId ?? crypto.randomUUID(),
      status: "running",
      createdAt: now,
      updatedAt: now,
      version: 1,
      limits: body.limits,
    };

    await this.ctx.storage.put(RUN_KEY, run);
    await this.emit(run, "run.started", { request: run.request });

    try {
      await this.beforeExecute();
      const context = await this.loadContext(run);
      const systemPrompt = this.composeSystemPrompt(context);
      const initialTools = this.gateTools(this.registerTools(context?.defaultTools ?? context?.tools ?? []));
      const result = await runModelLoop({
        host: {
          env: this.env,
          profile: this.profile,
          emit: (type, payload) => this.emit(run, type, payload),
          executeTool: (tool, args, toolCallId) => this.executeToolCall(run, tool, args, toolCallId),
          refreshTools: () => this.visibleTools(run),
        },
        run,
        context,
        systemPrompt,
        initialTools,
      });
      const output = await this.finalize(run, result);
      const completed = { ...run, status: "completed" as const, updatedAt: new Date().toISOString(), version: run.version + 1 };
      await this.ctx.storage.put(RUN_KEY, completed);
      await this.emit(completed, "run.completed", { output });
      return Response.json({ run: completed, output });
    } catch (error) {
      const failed = { ...run, status: "failed" as const, updatedAt: new Date().toISOString(), version: run.version + 1 };
      await this.ctx.storage.put(RUN_KEY, failed);
      await this.emit(failed, "run.failed", { error: describe(error) });
      return Response.json({ run: failed, error: describe(error) }, { status: 500 });
    }
  }

  private async transition(userId: string, action: "pause" | "resume" | "cancel"): Promise<Response> {
    const run = await this.ctx.storage.get<RunState>(RUN_KEY);
    if (!run) return Response.json({ error: "not_found" }, { status: 404 });
    if (run.userId !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
    const status = action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "running";
    const next: RunState = { ...run, status, updatedAt: new Date().toISOString(), version: run.version + 1 };
    await this.ctx.storage.put(RUN_KEY, next);
    await this.emit(next, `run.${action}`, {});
    return Response.json({ run: next });
  }

  private async eventsResponse(userId: string, after: number): Promise<Response> {
    const run = await this.ctx.storage.get<RunState>(RUN_KEY);
    if (run && run.userId !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
    const events = (await this.readEvents()).filter((event) => event.sequence > safeSequence(after));
    return Response.json({ format: "studio.runtime.events.v1", events, lastSequence: events.at(-1)?.sequence ?? safeSequence(after) });
  }

  private async websocketResponse(request: Request, userId: string, lastSeq: number): Promise<Response> {
    if ((request.headers.get("Upgrade") ?? "").toLowerCase() !== "websocket") {
      return Response.json({ error: "websocket_upgrade_required" }, { status: 426 });
    }
    const run = await this.ctx.storage.get<RunState>(RUN_KEY);
    if (run && run.userId !== userId) return Response.json({ error: "forbidden" }, { status: 403 });
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
    server.accept();
    this.sockets.add(server);
    server.addEventListener("close", () => this.sockets.delete(server));
    server.addEventListener("error", () => this.sockets.delete(server));
    server.send(JSON.stringify({ format: "studio.runtime.stream.ready.v1", lastSeq: safeSequence(lastSeq), timestamp: new Date().toISOString() }));
    for (const event of (await this.readEvents()).filter((item) => item.sequence > safeSequence(lastSeq))) {
      server.send(JSON.stringify(event));
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private async resolveApproval(userId: string, approvalId: string, body: unknown): Promise<Response> {
    const run = await this.requireUserRun(userId);
    const input = readObject(body);
    const approved = input.approved;
    if (typeof approved !== "boolean") return Response.json({ error: "invalid_request", message: "approved must be a boolean." }, { status: 400 });
    const artifactId = typeof input.artifactId === "string" ? input.artifactId : await this.findApprovalArtifactId(approvalId);
    if (!artifactId) return Response.json({ error: "approval_not_found" }, { status: 404 });
    const response = await this.postData(`/artifacts/${encodeURIComponent(artifactId)}/permissions`, userId, {
      conversationId: run.conversationId,
      permissionRequestId: approvalId,
      decision: approved ? "approved" : "rejected",
      decidedBy: typeof input.resolvedBy === "string" ? input.resolvedBy : "user",
      reason: typeof input.reason === "string" ? input.reason : undefined,
    });
    const data = await readJson<unknown>(response);
    if (!response.ok) return Response.json({ error: "permission_persist_failed", details: data }, { status: response.status });
    await this.emit(run, approved ? "approval.approved" : "approval.rejected", { approvalId, artifactId, data });
    return Response.json({ accepted: true, approvalId, artifactId, approved, data });
  }

  private async acceptExternalResolution(userId: string, path: string, body: unknown): Promise<Response> {
    const run = await this.requireUserRun(userId);
    await this.emit(run, "external.resolved", { path, body: typeof body === "object" && body !== null ? body as Record<string, unknown> : { value: body } });
    return Response.json({ accepted: true });
  }

  private async requireUserRun(userId: string): Promise<RunState> {
    const run = await this.ctx.storage.get<RunState>(RUN_KEY);
    if (!run) throw new Error("No active run.");
    if (run.userId !== userId) throw new Error("forbidden");
    return run;
  }

  private async findApprovalArtifactId(approvalId: string): Promise<string | undefined> {
    const events = await this.readEvents();
    for (const event of events) {
      if (event.type !== "artifact.permission.requested") continue;
      if (event.payload.permissionRequestId === approvalId && typeof event.payload.artifactId === "string") return event.payload.artifactId;
    }
    return undefined;
  }

  private broadcast(event: RuntimeEvent): void {
    const payload = JSON.stringify(event);
    for (const socket of [...this.sockets]) {
      try {
        socket.send(payload);
      } catch {
        this.sockets.delete(socket);
      }
    }
  }

  private async requireActiveRun(): Promise<RunState> {
    const run = await this.ctx.storage.get<RunState>(RUN_KEY);
    if (!run) throw new Error("No active run.");
    if (run.status === "completed" || run.status === "cancelled" || run.status === "failed") {
      throw new Error(`Run is ${run.status}; tools cannot be executed.`);
    }
    return run;
  }

  private async requireVisibleTool(run: RunState, toolName: string): Promise<RegisteredTool> {
    const tool = (await this.visibleTools(run))[toolName];
    if (!tool) throw new Error(`Tool ${toolName} is not available in this runtime context.`);
    return tool;
  }

  private async visibleTools(run: RunState): Promise<Record<string, RegisteredTool>> {
    const context = await this.loadContext(run);
    const activeTools = (await this.ctx.storage.get<StudioToolDescriptor[]>(ACTIVE_TOOLS_KEY)) ?? [];
    return this.gateTools(this.registerTools([...(context?.defaultTools ?? context?.tools ?? []), ...activeTools]));
  }

  private async loadContext(run: RunState): Promise<ContextPackage | null> {
    const response = await this.env.CONTEXT.fetch("https://context-engine/context-engine", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": run.userId },
      body: JSON.stringify({
        userId: run.userId,
        taskId: run.runId,
        conversationId: run.conversationId,
        task: run.request,
        consumer: this.profile.consumer,
      }),
    });
    if (!response.ok) return null;
    return (await response.json()) as ContextPackage;
  }

  private registerTools(descriptors: StudioToolDescriptor[]): Record<string, RegisteredTool> {
    return Object.fromEntries(descriptors.map((descriptor) => [descriptor.name, {
      descriptor,
      policy: {
        effect: descriptor.policy.effect ?? (descriptor.policy.requiresApproval ? "write" : "read"),
        requiresApproval: descriptor.policy.requiresApproval ?? false,
      },
    }]));
  }

  private async executeClientTool(run: RunState, tool: RegisteredTool, args: Record<string, unknown>, toolCallId: string): Promise<ToolExecutionResult> {
    if (tool.descriptor.route?.kind !== "client" || !["discover_tools", "resolve_tool", "expand_tool"].includes(tool.descriptor.route.action)) {
      return { ok: false, toolCallId, toolName: tool.descriptor.name, status: "failed", error: { code: "unsupported_client_tool", message: "Unsupported runtime-internal tool.", retryable: false } };
    }
    await this.emit(run, "tool.call.started", { toolCallId, toolName: tool.descriptor.name, internal: true });
    const path = tool.descriptor.route.action === "resolve_tool" ? "/resolve" : "/discover";
    const response = await this.env.TOOL_POOL.fetch(`https://tool-pool${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": run.userId },
      body: JSON.stringify({
        userId: run.userId,
        workspaceId: run.workspaceId,
        agentId: run.agentId,
        conversationId: run.conversationId,
        taskId: run.runId,
        task: run.request,
        consumer: this.profile.consumer,
        ...args,
      }),
    });
    const result = await readJson<unknown>(response);
    if (!response.ok) {
      const failure = { ok: false, toolCallId, toolName: tool.descriptor.name, status: "failed" as const, error: { code: "context_expansion_failed", message: JSON.stringify(result), retryable: response.status >= 500 } };
      await this.emit(run, "tool.call.failed", { toolCallId, toolName: tool.descriptor.name, result: failure });
      return failure;
    }
    if (tool.descriptor.route.action === "resolve_tool") {
      await this.mergeResolvedTools(result);
    }
    const success = { ok: true, toolCallId, toolName: tool.descriptor.name, status: "completed" as const, result };
    await this.emit(run, "tool.call.completed", { toolCallId, toolName: tool.descriptor.name, result: success });
    return success;
  }

  private async mergeResolvedTools(result: unknown): Promise<void> {
    const current = (await this.ctx.storage.get<StudioToolDescriptor[]>(ACTIVE_TOOLS_KEY)) ?? [];
    const incoming = readResolvedTools(result);
    const byName = new Map(current.map((tool) => [tool.name, tool]));
    for (const tool of incoming) byName.set(tool.name, tool);
    await this.ctx.storage.put(ACTIVE_TOOLS_KEY, [...byName.values()]);
  }

  private async readEvents(): Promise<RuntimeEvent[]> {
    this.cachedEvents = (await this.ctx.storage.get<RuntimeEvent[]>(EVENTS_KEY)) ?? [];
    return this.cachedEvents;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function transcriptEventFor(consumer: RuntimeProfile["consumer"], run: RunState, type: string, payload: Record<string, unknown>): Record<string, unknown> | null {
  const source = `${consumer}-runtime`;
  const base = {
    conversationId: run.conversationId,
    turnId: run.turnId,
    runId: run.runId,
    source,
    metadata: { runtime: consumer, eventType: type, ...payload },
  };
  if (type === "run.started") {
    return { ...base, kind: "user_message", visibility: "renderable", role: "user", content: run.request };
  }
  if (type === "run.completed") {
    const output = typeof payload.output === "string" ? payload.output : "";
    return { ...base, kind: "assistant_message", visibility: "renderable", role: "assistant", content: output, summary: output.slice(0, 2_000) };
  }
  if (type === "tool.call.started") {
    return {
      ...base,
      kind: "tool_call",
      visibility: "internal",
      toolCallId: stringValue(payload.toolCallId),
      toolName: stringValue(payload.toolName),
      summary: `Tool call started: ${stringValue(payload.toolName) ?? "unknown"}`,
    };
  }
  if (type === "tool.call.completed" || type === "tool.call.failed") {
    const result = payload.result;
    return {
      ...base,
      kind: "tool_result",
      visibility: "model",
      role: "tool",
      toolCallId: stringValue(payload.toolCallId),
      toolName: stringValue(payload.toolName),
      content: summarizeResult(result),
      summary: summarizeResult(result).slice(0, 2_000),
    };
  }
  if (type === "artifact.permission.requested") {
    return {
      ...base,
      kind: "artifact_permission_requested",
      visibility: "renderable",
      artifactId: stringValue(payload.artifactId),
      toolCallId: stringValue(payload.toolCallId),
      toolName: stringValue(payload.toolName),
      summary: stringValue(payload.title) ?? "Permission required",
      metadata: { ...base.metadata, permissionRequestId: stringValue(payload.permissionRequestId), artifactVersionId: stringValue(payload.artifactVersionId) },
    };
  }
  if (type === "artifact.completed" || type === "artifact.failed") {
    return {
      ...base,
      kind: type === "artifact.completed" ? "artifact_completed" : "artifact_failed",
      visibility: "renderable",
      artifactId: stringValue(payload.artifactId),
      summary: stringValue(payload.title) ?? type,
      metadata: { ...base.metadata, artifactVersionId: stringValue(payload.artifactVersionId), artifactStatus: stringValue(payload.status) },
    };
  }
  if (type.startsWith("run.")) {
    return { ...base, kind: "status", visibility: "audit", summary: type };
  }
  if (type.startsWith("approval.")) {
    return { ...base, kind: "artifact_updated", visibility: "renderable", artifactId: stringValue(payload.artifactId), summary: type };
  }
  return { ...base, kind: "runtime_event", visibility: "internal", summary: type };
}

function visibilityForRuntimeEvent(type: string): RuntimeEvent["visibility"] {
  if (type === "run.started" || type === "run.completed" || type.startsWith("artifact.") || type.startsWith("approval.")) return "renderable";
  if (type === "tool.call.completed" || type === "tool.call.failed") return "model";
  if (type.startsWith("run.")) return "audit";
  return "internal";
}

function safeSequence(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function summarizeResult(value: unknown): string {
  if (typeof value === "string") return value.slice(0, 32_000);
  try {
    return JSON.stringify(value).slice(0, 32_000);
  } catch {
    return String(value).slice(0, 32_000);
  }
}

function readToolCall(value: unknown): RuntimeToolCallBody {
  const input = readObject(value);
  const toolName = input.toolName;
  if (typeof toolName !== "string" || toolName.trim() === "") throw new Error("toolName is required.");
  const args = input.arguments;
  if (args !== undefined && (typeof args !== "object" || args === null || Array.isArray(args))) throw new Error("arguments must be an object.");
  const toolCallId = input.toolCallId;
  if (toolCallId !== undefined && typeof toolCallId !== "string") throw new Error("toolCallId must be a string.");
  return { toolName, arguments: args as Record<string, unknown> | undefined, toolCallId };
}

function readResolvedTools(result: unknown): StudioToolDescriptor[] {
  const body = typeof result === "object" && result !== null ? result as { matches?: unknown } : {};
  if (!Array.isArray(body.matches)) return [];
  return body.matches.flatMap((match) => {
    const item = typeof match === "object" && match !== null ? match as { tool?: unknown } : {};
    return isToolDescriptor(item.tool) ? [item.tool] : [];
  });
}

function requiresRuntimeApproval(tool: RegisteredTool): boolean {
  return tool.policy.requiresApproval || tool.policy.effect === "write" || tool.policy.effect === "destructive";
}

function readArtifactProposal(value: unknown): ArtifactProposal | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  return {
    presentation_intent: typeof input.presentation_intent === "string" ? input.presentation_intent : undefined,
    title: typeof input.title === "string" ? input.title : undefined,
    summary: typeof input.summary === "string" ? input.summary : undefined,
    activity_label: typeof input.activity_label === "string" ? input.activity_label : undefined,
    body: typeof input.body === "string" ? input.body : undefined,
    fields: typeof input.fields === "object" && input.fields !== null && !Array.isArray(input.fields) ? input.fields as Record<string, unknown> : undefined,
    requires_permission: typeof input.requires_permission === "boolean" ? input.requires_permission : undefined,
  };
}

function readArtifactProposalFromResult(value: unknown): ArtifactProposal | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  return readArtifactProposal(input.artifactProposal) ?? readArtifactProposal(input);
}

function artifactFamilyFor(tool: RegisteredTool, proposal: ArtifactProposal | undefined): string {
  if (proposal?.presentation_intent === "research") return "research";
  if (proposal?.presentation_intent === "generated_media") return "generated_media";
  if (proposal?.presentation_intent === "connector_record") return "connector_record";
  if (proposal?.presentation_intent === "connector_action") return "connector_action";
  if (proposal?.presentation_intent === "file") return "file";
  if (proposal?.presentation_intent === "structured_data") return "structured_data";
  if (tool.descriptor.route?.kind === "connector") return tool.policy.effect === "read" ? "connector_record" : "connector_action";
  if (tool.descriptor.route?.kind === "native-cloud" && tool.descriptor.route.serviceId.includes("image")) return "generated_media";
  return "activity";
}

function artifactTypeFor(tool: RegisteredTool): string {
  const route = tool.descriptor.route;
  if (!route) return "runtime_action";
  if (route.kind === "connector") return `connector.${route.slug}`;
  if (route.kind === "native-cloud") return `native.${route.serviceId}.${route.toolName}`;
  if (route.kind === "memory") return `memory.${route.operation}`;
  if (route.kind === "agent-runtime") return `agent.${route.action}`;
  if (route.kind === "skill-library") return `skill.${route.action}`;
  if (route.kind === "remote-mcp" || route.kind === "mcp-server") return `mcp.${route.serverId}.${route.toolName ?? tool.descriptor.name}`;
  return route.kind;
}

function safeTitle(input: string | undefined, fallback: string): string {
  const value = (input ?? fallback).trim();
  return value.length > 0 ? value.slice(0, 140) : "Studio action";
}

function isToolDescriptor(value: unknown): value is StudioToolDescriptor {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return typeof record.name === "string" && typeof record.description === "string" && typeof record.inputSchema === "object" && record.inputSchema !== null;
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Expected an object.");
  return value as Record<string, unknown>;
}

async function readJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    return { ok: false, error: { code: "invalid_tool_execution_response", message: text } } as T;
  }
}
