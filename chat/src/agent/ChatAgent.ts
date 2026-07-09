/**
 * ChatAgent — Cloudflare Agents SDK entry point for AI chat.
 *
 * Extends Agent<Env, ChatAgentState> so it is natively a Durable Object with:
 *   - WebSocket connections (onMessage / onConnect / onClose)
 *   - Persistent state (this.setState / this.state) in DO-backed SQLite
 *   - Sub-agent management (this.subAgent) for research specialists
 *   - Scheduled tasks and durable fibers for long-running work
 *
 * Protocol (WebSocket messages):
 *
 *   CLIENT → AGENT
 *   ─────────────────────────────────────────────────────────────────────
 *   { type: "start",        body: ChatRequestBody }
 *     Start a new conversation turn. Runs the full pipeline + agent loop.
 *     Agent streams events back and may reach local_tools_pending.
 *
 *   { type: "tool_results", results: ToolResultItem[], pending_specialist? }
 *     Tauri executed local tools and sends ONLY the results — no full history.
 *     Agent resumes from its stored pendingMessages state.
 *
 *   AGENT → CLIENT (JSON strings)
 *   ─────────────────────────────────────────────────────────────────────
 *   Same event types as the HTTP path (forwarded from SSE pipeline):
 *     { type: "stream", ...sseChunk format }
 *     { type: "tool_start",           callId, tool, args }
 *     { type: "tool_complete",        callId, tool, result }
 *     { type: "local_tools_pending",  toolCalls, pendingSpecialist? }
 *     { type: "done" }
 *     { type: "error",                error }
 *
 * KEY WIN: on tool_results resume, Tauri sends ~1KB of results instead of
 * the full 70KB+ message history that the old HTTP relay required.
 *
 * Routing: exported from index.ts, declared in wrangler.toml as new_sqlite_class.
 * Access via routeAgentRequest → /agents/chat-agent/{conversationId}
 */
import { Agent, getCurrentAgent as sdkGetCurrentAgent } from "agents";
import type { Connection, WSMessage } from "agents";
import type { Env } from "../env";
import { runAgentLoop } from "./loop";
import type { AgentLoopInput } from "./loop";
import { runWithEnv, runWithCtx, setRequestContext, clearRequestContext, setRequestRegistry, hasRequestRegistry } from "../context";
import { logger } from "../logger";
import { getApiKey, PROVIDER_URLS } from "../server/providers";
import type { AgentMessage } from "./state";
import { preprocessVision } from "../inputs/image";
import { createAccumulator } from "./completion";

// ---------------------------------------------------------------------------
// Re-export getCurrentAgent as a typed helper for tools
// ---------------------------------------------------------------------------

/**
 * Get the currently-executing ChatAgent instance.
 * Returns undefined when not running inside a ChatAgent WebSocket handler.
 * Usage: `const agent = getChatAgent(); if (!agent) return error;`
 */
export function getChatAgent(): ChatAgent | undefined {
  return sdkGetCurrentAgent<ChatAgent>()?.agent;
}

// Keep the original name for backward compat with existing imports
export { sdkGetCurrentAgent as getCurrentAgent };

// ---------------------------------------------------------------------------
// Persistent DO state (stored in SQLite by the SDK)
// ---------------------------------------------------------------------------

export interface ChatAgentState {
  // Stored during a local_tools_pending relay — client only sends tool results on resume
  pendingMessages:   AgentMessage[];

  // Non-sensitive session config (API keys re-derived from env on each message)
  userId:               string | null;
  modelId:              string;
  provider:             string;
  apiBaseUrl:           string;
  temperature:          number;
  maxTokens:            number | undefined;
  localEngineConnected: boolean;
  requestId:            string;
  runningMcpServers:    string[];

  /**
   * Completed response text saved when the agent loop finishes but the
   * WebSocket is already closed (client navigated away, browser closed, etc.).
   * The client retrieves this via GET /agents/chat-agent/{id}/completed and
   * then clears it via DELETE so it is not delivered twice.
   */
  completedContent: string | null;
}

// ---------------------------------------------------------------------------
// WebSocket message shapes (client → agent)
// NOTE: The canonical source of truth for this protocol is mirrored in
// STUDIO/src/runtime/protocol.ts (the Local Runtime's public contract).
// Keep both sides in sync when adding/changing a message shape.
// ---------------------------------------------------------------------------

interface ChatRequestBody {
  messages:                AgentMessage[];
  model:                   string;
  stream?:                 boolean;
  temperature?:            number;
  max_tokens?:             number;
  calling_app?:            string;
  local_engine_connected?: boolean;
  // Forwarded for tool context
  user_id?:                string;
  user_profile?:           string;
  running_mcp_servers?:    string[];
}

interface StartMessage {
  type: "start";
  body: ChatRequestBody;
}

interface ToolResultItem {
  call_id: string;
  content: string;
  name?:   string;
}

interface ToolResultsMessage {
  type:                "tool_results";
  results:             ToolResultItem[];
}

interface PingMessage {
  type: "ping";
}

type IncomingMessage = StartMessage | ToolResultsMessage | PingMessage;

// ---------------------------------------------------------------------------
// ChatAgent
// ---------------------------------------------------------------------------

export class ChatAgent extends Agent<Env, ChatAgentState> {
  override initialState: ChatAgentState = {
    pendingMessages:      [],
    userId:               null,
    modelId:              "",
    provider:             "",
    apiBaseUrl:           "",
    temperature:          0.7,
    maxTokens:            undefined,
    localEngineConnected: false,
    requestId:            "",
    runningMcpServers:    [],
    completedContent:     null,
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  override async onStart(): Promise<void> {
    // Blackboard moved to the studio-agents BlackboardDO (reachable by chat via
    // the AGENTS binding and by sub-agents directly) — nothing to init here.
  }

  // ── HTTP fallback ─────────────────────────────────────────────────────────

  override async onRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);

    // ── GET /agents/chat-agent/{id}/completed ─────────────────────────────
    // Returns any response the agent loop saved while the client was
    // disconnected. The client calls this on conversation load; if content
    // is present, it saves the message locally and then calls DELETE below.
    if (request.method === "GET" && pathname.endsWith("/completed")) {
      return Response.json({ content: this.state.completedContent ?? null });
    }

    // ── DELETE /agents/chat-agent/{id}/completed ──────────────────────────
    // Discards the saved content after the client has stored it.
    if (request.method === "DELETE" && pathname.endsWith("/completed")) {
      if (this.state.completedContent !== null) {
        this.setState({ ...this.state, completedContent: null });
      }
      return Response.json({ ok: true });
    }

    return new Response(
      JSON.stringify({
        type:    "info",
        message: "Connect via WebSocket at /agents/chat-agent/{conversationId} for AI chat.",
        version: "agents-sdk",
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  }

  // ── WebSocket handlers ────────────────────────────────────────────────────

  override async onMessage(connection: Connection, message: WSMessage): Promise<void> {
    let msg: IncomingMessage;
    try {
      msg = JSON.parse(message as string) as IncomingMessage;
    } catch {
      this.sendJson(connection, { type: "error", error: "Invalid JSON message" });
      return;
    }

    try {
      if (msg.type === "start") {
        // Register with waitUntil so the DO stays alive if the WebSocket closes
        // mid-stream (user navigates away, closes browser, etc.). The loop runs
        // to completion and saves completedContent to DO state for catch-up.
        const work = this.handleChatStart(connection, msg);
        this.ctx.waitUntil(work);
        await work;
      } else if (msg.type === "tool_results") {
        const work = this.handleToolResults(connection, msg);
        this.ctx.waitUntil(work);
        await work;
      } else if (msg.type === "ping") {
        // Silently accept keepalive pings — the client sends these every 25s
        // to prevent Cloudflare from closing idle WebSockets. No reply needed.
      } else {
        this.sendJson(connection, { type: "error", error: "Unknown message type" });
      }
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error("ChatAgent: unhandled message error", { error: errMsg });
      this.sendJson(connection, { type: "error", error: "Something went wrong. Please try again." });
    }
  }

  override async onClose(
    _connection: Connection,
    _code: number,
    _reason: string,
    _wasClean: boolean
  ): Promise<void> {
    logger.info("ChatAgent: client disconnected", { name: this.name });
  }

  // ── Chat start ────────────────────────────────────────────────────────────

  private async handleChatStart(
    connection: Connection,
    msg: StartMessage
  ): Promise<void> {
    const { body } = msg;

    // Clear any stale catch-up content — a new turn is starting.
    if (this.state.completedContent !== null) {
      this.setState({ ...this.state, completedContent: null });
    }

    // Accumulator captures text chunks so the response can be saved to DO
    // state if the client disconnects before receiving the `done` event.
    const rawSend  = (data: string) => { try { connection.send(data); } catch {} };
    const accumulator = createAccumulator(rawSend);
    const send = (data: string) => accumulator.send(data);

    logger.info("ChatAgent: handleChatStart received", {
      model:        body.model,
      messageCount: body.messages?.length ?? 0,
      userId:       body.user_id,
    });

    const fakeCtx = this.makeFakeCtx();

    await runWithEnv(this.env, () => runWithCtx(fakeCtx, async () => {
      const requestId = crypto.randomUUID();

      // Build a synthetic Request so we can reuse the existing registry/preload pipeline.
      // parseRequest handles "auto" routing — do NOT call parseModelId before it.
      const syntheticReq = new Request("https://agent.internal/v1/chat/completions", {
        method:  "POST",
        headers: { "Content-Type": "application/json", ...(body.user_id ? { "x-user-id": body.user_id } : {}) },
        body:    JSON.stringify(body),
      });

      // Run the full pipeline stages — same sequence as the HTTP path
      const { parseRequest }       = await import("../pipeline/parse");
      const { extractUserContext } = await import("../pipeline/userContext");
      const { preload }            = await import("../pipeline/preload");
      const { assembleMessages }   = await import("../pipeline/assembleMessages");

      const parsed = await parseRequest(syntheticReq, this.env);
      if (parsed instanceof Response) {
        const errText = await parsed.clone().text().catch(() => "(unreadable)");
        logger.error("ChatAgent: parseRequest failed", { status: parsed.status, body: errText });
        this.sendJson(connection, { type: "error", error: "Unable to start this conversation. Please check your settings and try again." });
        return;
      }

      // Use the resolved provider/model from parseRequest (handles "auto" routing).
      const { provider, modelId, apiKey, apiBaseUrl } = parsed;
      logger.info("ChatAgent: parseRequest OK", { provider, modelId, hasApiKey: !!apiKey });

      const pipelineCtx = {
        request:              syntheticReq,
        env:                  this.env,
        ctx:                  fakeCtx,
        requestStart:         Date.now(),
        isServiceBinding:     true, // ChatAgent always runs inside the worker — internal path
        ...parsed,
        userId:               undefined,
        userContext:          {} as import("../tools/base/types").UserContext,
        localEngineConnected: false,
        userProfile:          null,
        memoryContext:        null,
        skillsIndex:          null,
        mcpServers:           [],
        mcpDynamicTools:      [],
        composioTools:        [],
        composioApps:         [],
        requestRegistry:      null as unknown as import("../tools").ToolRegistry,
        messages:             [],
        requestId:            "",
        threadId:             "",
        workerBaseUrl:        "",
        tavilyApiKey:         "",
      } as import("../pipeline/types").ChatPipelineContext;

      await extractUserContext(pipelineCtx);
      await preload(pipelineCtx);
      assembleMessages(pipelineCtx);

      // Vision preprocessing — substitute data URLs with R2 presigned URLs.
      // Same as the HTTP path; without this, large image payloads would be sent
      // inline and may exceed provider limits or cause stale URL issues.
      const visionError = await preprocessVision(pipelineCtx);
      if (visionError) {
        this.sendJson(connection, { type: "error", error: "Vision preprocessing failed" });
        return;
      }
      // Forward R2 substitutions to the client so it can update its message store
      if (pipelineCtx.visionSubstitutions?.length) {
        send(JSON.stringify({ type: "vision_substitutions", substitutions: pipelineCtx.visionSubstitutions }));
      }

      // Dispatch sets up requestId, threadId, workerBaseUrl, tavilyApiKey
      const { setupDispatch } = await import("../pipeline/dispatch");
      setupDispatch(pipelineCtx);

      const registry = pipelineCtx.requestRegistry;
      setRequestRegistry(requestId, registry);

      // Store session config for relay resumption
      const userId = pipelineCtx.userContext?.userId ?? body.user_id ?? null;
      this.setState({
        ...this.state,
        userId,
        modelId,
        provider,
        apiBaseUrl,
        temperature:          body.temperature ?? 0.7,
        maxTokens:            body.max_tokens,
        localEngineConnected: body.local_engine_connected ?? false,
        requestId,
        runningMcpServers:    body.running_mcp_servers ?? [],
      });

      const loopInput: AgentLoopInput = {
        messages:             pipelineCtx.messages,
        modelId,
        provider,
        apiKey,
        apiBaseUrl,
        temperature:          body.temperature ?? 0.7,
        maxTokens:            body.max_tokens,
        localEngineConnected: body.local_engine_connected ?? false,
        runningMcpServers:    body.running_mcp_servers ?? [],
        tavilyApiKey:         this.env.TAVILY_API_KEY ?? "",
        userContext:          pipelineCtx.userContext as unknown,
        requestId,
      };

      const result = await runAgentLoop(loopInput, send);

      if (result.localToolsPending) {
        // KEY WIN: store history so client only sends tool results on resume (~1KB vs 70KB+)
        this.setState({
          ...this.state,
          pendingMessages: result.resolvedMessages,
        });
        // local_tools_pending already emitted via send()
      } else {
        // Save accumulated content so a reconnecting client can retrieve it
        // if the `done` send below fails (WS already closed).
        const completed = accumulator.getContent();
        this.setState({
          ...this.state,
          pendingMessages:  [],
          completedContent: completed || null,
        });

        await this.distillMemory(userId ?? undefined, result.resolvedMessages);
        send(JSON.stringify({ type: "done" }));
        clearRequestContext(requestId);
      }
    }));
  }

  // ── Tool results resume ───────────────────────────────────────────────────

  private async handleToolResults(
    connection: Connection,
    msg: ToolResultsMessage
  ): Promise<void> {
    if (!this.state.requestId) {
      this.sendJson(connection, { type: "error", error: "No pending conversation. Send a start message first." });
      return;
    }

    const rawSend    = (data: string) => { try { connection.send(data); } catch {} };
    const accumulator = createAccumulator(rawSend);
    const send       = (data: string) => accumulator.send(data);
    const { requestId, modelId, provider, apiBaseUrl, temperature, maxTokens, localEngineConnected } = this.state;
    const fakeCtx = this.makeFakeCtx();

    await runWithEnv(this.env, () => runWithCtx(fakeCtx, async () => {
      const apiKey = getApiKey(this.env, provider) ?? "";

      // If the DO hibernated between turns the module-level registries Map is gone.
      // Rebuild it from stored state so the agent loop has MCP tool definitions.
      if (!hasRequestRegistry(requestId)) {
        logger.info("ChatAgent: registry cleared by hibernation — rebuilding", { requestId });
        const { preload } = await import("../pipeline/preload");
        const minCtx: any = {
          env:                  this.env,
          ctx:                  fakeCtx,
          body:                 { running_mcp_servers: this.state.runningMcpServers ?? [] },
          userId:               this.state.userId,
          userContext:          { userId: this.state.userId },
          localEngineConnected,
          mcpDynamicTools:      [],
          composioTools:        [],
          composioApps:         [],
          requestId,
          requestRegistry:      null,
        };
        await preload(minCtx);
        if (minCtx.requestRegistry) {
          setRequestRegistry(requestId, minCtx.requestRegistry);
        }
      }

      // KEY WIN: append ONLY the new tool results to stored history — no full history resend
      const messages: AgentMessage[] = [
        ...this.state.pendingMessages,
        ...msg.results.map(r => ({
          role:         "tool" as const,
          content:      r.content,
          tool_call_id: r.call_id,
          name:         r.name,
        })),
      ];

      const loopInput: AgentLoopInput = {
        messages,
        modelId,
        provider,
        apiKey,
        apiBaseUrl,
        temperature,
        maxTokens,
        localEngineConnected,
        runningMcpServers: this.state.runningMcpServers ?? [],
        tavilyApiKey: this.env.TAVILY_API_KEY ?? "",
        userContext:  {} as unknown,
        requestId,
      };

      const result = await runAgentLoop(loopInput, send);

      if (result.localToolsPending) {
        this.setState({ ...this.state, pendingMessages: result.resolvedMessages });
      } else {
        const completed = accumulator.getContent();
        this.setState({
          ...this.state,
          pendingMessages:  [],
          completedContent: completed || null,
        });

        await this.distillMemory(this.state.userId ?? undefined, result.resolvedMessages);
        send(JSON.stringify({ type: "done" }));
        clearRequestContext(requestId);
      }
    }));
  }

  // Blackboard moved to the studio-agents BlackboardDO. The write_to_blackboard /
  // read_from_blackboard tools now call it via the AGENTS service binding
  // (scope = this.name = conversationId). See tools/agentic/blackboard.ts.

  // ── Helpers ───────────────────────────────────────────────────────────────

  /**
   * Sends the last 30 user/assistant messages to the STUDIO Memory worker.
   * The worker's /process endpoint returns immediately ({queued:true}) and
   * handles extraction + D1 writes in its own waitUntil. We await here because
   * the Agents SDK hibernation model cancels in-flight service binding fetches
   * once the onMessage handler context ends.
   */
  private async distillMemory(userId: string | undefined, resolvedMessages: AgentMessage[]): Promise<void> {
    if (!userId || !this.env.MEMORY) return;
    const turnMessages = resolvedMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .slice(-30);
    await this.env.MEMORY.fetch(new Request("http://memory/process", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user_id:         userId,
        conversation_id: this.name,
        messages:        turnMessages,
      }),
    })).catch(() => {});
  }

  private sendJson(connection: Connection, data: unknown): void {
    try { connection.send(JSON.stringify(data)); } catch {}
  }

  /**
   * Build a minimal ExecutionContext that delegates waitUntil() to the DO's
   * own context. Used so that tracking / span calls inside runAgentLoop can
   * use `ctx.waitUntil()` for fire-and-forget instead of the default no-op path.
   */
  private makeFakeCtx(): ExecutionContext {
    return {
      waitUntil:              (p: Promise<unknown>) => this.ctx.waitUntil(p),
      passThroughOnException: () => {},
      props:                  {},
    } as unknown as ExecutionContext;
  }
}
