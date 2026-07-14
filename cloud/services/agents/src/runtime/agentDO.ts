/// <reference types="@cloudflare/workers-types" />

import { Agent } from "agents";
import type { Env } from "../env";
import type { AgentState, AgentRunConfig } from "./types";
import type { AgentToolDescriptor } from "../tools/types";
import { loadAgentTools } from "../tools/loader";
import { NotConnectedBridge } from "../tools/clientBridge";
import { runAgentLoop } from "./loop";
import { emitAgentEvent } from "./tracker";
import { buildSystemPrompt } from "./systemPrompt";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * A run whose heartbeat is older than this is considered stalled — the DO
 * instance driving it died (crash / eviction / deploy). The watchdog then
 * resumes it from the last checkpoint. Generous, because the loop beats the
 * heartbeat before every LLM step, so a stall this long means genuinely no
 * code is running (not merely a slow model call).
 */
const STALE_RUN_MS = 150_000;

/** How often the self-healing watchdog re-checks a running agent. */
const WATCHDOG_SECONDS = 60;

/** Cap on automatic resumes before a stalled run is marked failed. */
const MAX_RESUMES = 3;

const EMPTY_STATE: AgentState = {
  status:      "idle",
  runId:       "",
  userId:      "",
  config:      {} as AgentRunConfig,
  iteration:   0,
  totalTokens: 0,
  messages:    [],
  generation:  0,
  resumeCount: 0,
};

/**
 * BaseAgentDO — the Durable Object every cloud agent type extends.
 *
 * One instance per run, addressed by runId (idFromName(runId)). The Agent SDK's
 * SQLite-backed state IS the checkpoint: messages, iteration, and tokens persist
 * across hibernation, so a run survives isolate eviction.
 *
 * Resilience:
 *   - The loop beats a heartbeat (lastActiveAt) before every LLM step.
 *   - A self-healing watchdog (scheduled via the SDK) resumes a stalled run from
 *     its checkpoint, up to MAX_RESUMES times, then fails it.
 *   - A monotonic `generation` token guards state: only the loop whose captured
 *     generation still matches commits state, so a resumed run cleanly supersedes
 *     a zombie loop instead of both corrupting state.
 *
 * Sub-classes declare SYSTEM_PROMPT and optionally restrict buildToolDescriptors().
 *
 * HTTP API (internal, via service binding from chat / the spawn route):
 *   POST /run     { AgentRunConfig }  → start the loop, run to completion
 *   GET  /status                      → { state: AgentState }
 *   POST /cancel                      → cancel a running loop
 */
export abstract class BaseAgentDO extends Agent<Env, AgentState> {
  /** Every concrete agent type must supply its system prompt. */
  protected abstract readonly SYSTEM_PROMPT: string;

  /**
   * Override in sub-classes to restrict the tool catalog.
   * Default: all tools the user has enabled (full reach).
   */
  protected buildToolDescriptors(env: Env, userId: string): Promise<AgentToolDescriptor[]> {
    return loadAgentTools(env, userId);
  }

  initialState = EMPTY_STATE;

  // ── fetch handler ─────────────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    const url    = new URL(request.url);
    const method = request.method;

    if (url.pathname === "/run" && method === "POST")    return this.handleRun(request);
    if (url.pathname === "/status" && method === "GET")  return json({ state: this.state });
    if (url.pathname === "/cancel" && method === "POST") return this.handleCancel();

    return new Response("Not Found", { status: 404 });
  }

  // ── /run ──────────────────────────────────────────────────────────────────

  private async handleRun(request: Request): Promise<Response> {
    // Reject only a genuinely-live run. If the heartbeat is stale, the previous
    // driver died — allow this call to take over.
    if (this.state.status === "running" && !this.isStalled()) {
      return json({ error: "Agent is already running" }, 409);
    }

    let config: AgentRunConfig;
    try { config = await request.json() as AgentRunConfig; }
    catch { return json({ error: "Invalid JSON body" }, 400); }

    // Seed a fresh run. executeRun() bumps the generation.
    await this.setState({
      ...EMPTY_STATE,
      status:       "running",
      runId:        config.runId,
      userId:       config.userId,
      config,
      messages:     config.messages,
      startedAt:    Date.now(),
      lastActiveAt: Date.now(),
    });

    emitAgentEvent(this.env, {
      event:  "agent.spawned",
      userId: config.userId,
      runId:  config.runId,
      data:   { model: config.model, conversationId: config.conversationId },
    });

    // Arm the self-healing watchdog, then drive the loop.
    await this.schedule(WATCHDOG_SECONDS, "watchdog");
    return this.executeRun(false);
  }

  // ── the run engine (fresh start OR resume) ──────────────────────────────────

  private async executeRun(resume: boolean): Promise<Response> {
    const config = this.state.config;
    const myGen  = (this.state.generation ?? 0) + 1;

    await this.setState({
      ...this.state,
      status:       "running",
      generation:   myGen,
      lastActiveAt: Date.now(),
      ...(resume ? { resumeCount: (this.state.resumeCount ?? 0) + 1 } : {}),
    });

    /** State still belongs to this generation and hasn't been cancelled. */
    const mine = () => this.state.generation === myGen && this.state.status !== "cancelled";

    try {
      const tools  = await this.buildToolDescriptors(this.env, config.userId);
      const bridge = new NotConnectedBridge();

      const basePrompt   = config.systemPrompt || this.SYSTEM_PROMPT;
      const systemPrompt = buildSystemPrompt(basePrompt, config);

      const result = await runAgentLoop(
        this.env,
        { ...config, systemPrompt },
        tools,
        bridge,
        {
          // Beat the heartbeat before each (slow) LLM call — only if still ours.
          onBeforeStep: async () => {
            if (this.state.generation === myGen) {
              await this.setState({ ...this.state, lastActiveAt: Date.now() });
            }
          },
          // Checkpoint after each iteration — only if still ours (no zombie clobber).
          onIteration: async (iteration, totalTokens, messages) => {
            if (this.state.generation !== myGen) return;
            await this.setState({ ...this.state, iteration, totalTokens, messages, lastActiveAt: Date.now() });
          },
          shouldContinue: () => mine(),
          ...(resume
            ? { startMessages: this.state.messages, startIteration: this.state.iteration, startTokens: this.state.totalTokens }
            : {}),
        },
      );

      // A newer generation took over (watchdog resume) — it owns the state now.
      if (this.state.generation !== myGen) {
        return json({ ok: false, superseded: true });
      }

      if (result.stopReason === "cancelled") {
        // Distinguish a real user cancel from a supersede-driven stop.
        if (this.state.status === "cancelled") {
          await this.finish("cancelled", config, result);
          return json({ ok: false, cancelled: true, result: result.finalMessage });
        }
        return json({ ok: false, superseded: true });
      }

      await this.finish("done", config, result);
      return json({
        ok:         true,
        result:     result.finalMessage,
        stopReason: result.stopReason,
        iterations: result.iterations,
        tokens:     result.totalTokens,
      });

    } catch (err) {
      if (this.state.generation !== myGen) return json({ ok: false, superseded: true });
      const error = err instanceof Error ? err.message : String(err);
      await this.setState({ ...this.state, status: "failed", error, finishedAt: Date.now() });
      emitAgentEvent(this.env, {
        event: "agent.failed", severity: "error",
        userId: config.userId, runId: config.runId, data: { error },
      });
      return json({ error }, 500);
    }
  }

  /** Commit a terminal result and emit the matching lifecycle event. */
  private async finish(
    status: "done" | "cancelled",
    config: AgentRunConfig,
    result: { finalMessage: string; iterations: number; totalTokens: number; stopReason: string },
  ): Promise<void> {
    await this.setState({
      ...this.state,
      status,
      iteration:   result.iterations,
      totalTokens: result.totalTokens,
      result:      result.finalMessage,
      finishedAt:  Date.now(),
    });
    emitAgentEvent(this.env, {
      event:  status === "done" ? "agent.done" : "agent.cancelled",
      userId: config.userId,
      runId:  config.runId,
      data:   { stopReason: result.stopReason, iterations: result.iterations, tokens: result.totalTokens },
    });
  }

  // ── self-healing watchdog (scheduled via the SDK) ───────────────────────────

  /** Public so the Agents SDK can invoke it by name from a scheduled alarm. */
  async watchdog(): Promise<void> {
    // Terminal — stop the watchdog chain.
    if (this.state.status !== "running") return;

    // Re-arm for the next check while the run is active.
    await this.schedule(WATCHDOG_SECONDS, "watchdog");

    // Still alive — nothing to do.
    if (!this.isStalled()) return;

    // Stalled. Resume from checkpoint, bounded.
    if ((this.state.resumeCount ?? 0) >= MAX_RESUMES) {
      const error = `Run stalled and exceeded ${MAX_RESUMES} auto-resumes.`;
      await this.setState({ ...this.state, status: "failed", error, finishedAt: Date.now() });
      emitAgentEvent(this.env, {
        event: "agent.failed", severity: "error",
        userId: this.state.userId, runId: this.state.runId, data: { error },
      });
      return;
    }

    emitAgentEvent(this.env, {
      event: "agent.resumed", severity: "warn",
      userId: this.state.userId, runId: this.state.runId,
      data: { fromIteration: this.state.iteration, resumeCount: (this.state.resumeCount ?? 0) + 1 },
    });
    await this.executeRun(true);
  }

  // ── /cancel ─────────────────────────────────────────────────────────────────

  private async handleCancel(): Promise<Response> {
    if (this.state.status === "running") {
      await this.setState({ ...this.state, status: "cancelled", finishedAt: Date.now() });
    }
    return json({ ok: true });
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  private isStalled(): boolean {
    return this.state.lastActiveAt == null || Date.now() - this.state.lastActiveAt > STALE_RUN_MS;
  }
}
