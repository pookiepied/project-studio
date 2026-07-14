import type { ContextPackage, ExecutionLimits, RunState, StudioToolDescriptor, ToolEffect } from "../contracts";

export interface RuntimeEnv {
  GATEWAY: Fetcher;
  CONTEXT: Fetcher;
  DATA: Fetcher;
  MCP: Fetcher;
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
}

interface RuntimeEvent {
  eventId: string;
  runId: string;
  sequence: number;
  type: string;
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

const RUN_KEY = "run:current";
const EVENTS_KEY = "run:events";

export abstract class RuntimeSession<Env extends RuntimeEnv> {
  protected readonly ctx: DurableObjectState;
  protected readonly env: Env;
  protected abstract readonly profile: RuntimeProfile;
  private cachedEvents: RuntimeEvent[] = [];

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
      return Response.json({ run: run ?? null }, { status: run ? 200 : 404 });
    }
    if (request.method === "GET" && url.pathname === "/ws") {
      return Response.json({ error: "websocket_not_implemented" }, { status: 501 });
    }
    if (request.method === "POST" && ["/pause", "/resume", "/cancel"].includes(url.pathname)) {
      return this.transition(url.pathname.slice(1) as "pause" | "resume" | "cancel");
    }
    if (request.method === "POST" && url.pathname === "/tools/execute") {
      return this.executeRequestedTool(await request.json());
    }
    if (request.method === "POST" && url.pathname === "/tools/execute/batch") {
      return this.executeRequestedTools(await request.json());
    }
    if (request.method === "POST" && (url.pathname.startsWith("/approvals/") || url.pathname.startsWith("/external-tools/") || url.pathname.startsWith("/client-actions/"))) {
      return Response.json({ accepted: true });
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
    events.push({
      eventId: crypto.randomUUID(),
      runId: run.runId,
      sequence: events.length + 1,
      type,
      timestamp: new Date().toISOString(),
      payload,
    });
    await this.ctx.storage.put(EVENTS_KEY, events);
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

  protected async executeToolCall(run: RunState, tool: RegisteredTool, args: Record<string, unknown>, toolCallId: string = crypto.randomUUID()): Promise<ToolExecutionResult> {
    if (!tool.descriptor.route) {
      return { ok: false, toolCallId, toolName: tool.descriptor.name, status: "failed", error: { code: "missing_tool_route", message: "Tool descriptor does not include an execution route." } };
    }
    const payload = {
      userId: run.userId,
      workspaceId: run.workspaceId,
      sessionId: run.runId,
      conversationId: run.conversationId,
      agentId: run.agentId,
      agentExecutionId: this.profile.consumer === "agent" ? run.runId : undefined,
      toolCallId,
      toolName: tool.descriptor.name,
      arguments: args,
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
    await this.emit(run, result.ok ? "tool.call.completed" : "tool.call.failed", { toolCallId, toolName: tool.descriptor.name, result });
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
        route: call.tool.descriptor.route,
      })),
    };
    const response = await this.env.TOOL_EXECUTION.fetch("https://tool-execution/execute/batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": run.userId },
      body: JSON.stringify(payload),
    });
    const body = await readJson<{ results?: ToolExecutionResult[] }>(response);
    return body.results ?? [];
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
      this.composeSystemPrompt(context);
      this.gateTools(this.registerTools(context?.tools ?? []));
      const result: LoopResult = { text: "" };
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

  private async transition(action: "pause" | "resume" | "cancel"): Promise<Response> {
    const run = await this.ctx.storage.get<RunState>(RUN_KEY);
    if (!run) return Response.json({ error: "not_found" }, { status: 404 });
    const status = action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "running";
    const next: RunState = { ...run, status, updatedAt: new Date().toISOString(), version: run.version + 1 };
    await this.ctx.storage.put(RUN_KEY, next);
    await this.emit(next, `run.${action}`, {});
    return Response.json({ run: next });
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
    return this.gateTools(this.registerTools(context?.tools ?? []));
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

  private async readEvents(): Promise<RuntimeEvent[]> {
    this.cachedEvents = (await this.ctx.storage.get<RuntimeEvent[]>(EVENTS_KEY)) ?? [];
    return this.cachedEvents;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
