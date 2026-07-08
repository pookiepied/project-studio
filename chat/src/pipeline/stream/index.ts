import { ChatPipelineContext } from "../types";
import { STUDIO_HARNESS_BLOCKED } from "../../tools/mcp/blocklist";
import { createProvider } from "../../server/providers";
import { CapturedUsage } from "@gateway/providers/types";
import { getRegistryById, clearRequestRegistry, clearRequestContext } from "../../context";
import { addCORSHeaders } from "@gateway/middleware/cors";
import {
  EXPAND_TOOLS_DEFINITION,
  getExpandCountSinceLastUser,
} from "../../tools/agentic/expandTools";
import { sseChunk } from "./helpers";
import { runPhase1 } from "./llm";
import { runPhase2 } from "./tools";
import { emit } from "../../tracking";
import { logger } from "../../logger";
import { fireMemoryProcess } from "../preload";
import type { AgentMessage } from "../../agent/state";
import {
  INACTIVITY_TIMEOUT_MS,
  ABSOLUTE_TIMEOUT_MS,
  HEARTBEAT_INTERVAL_MS,
} from "../../constants";

/**
 * Streaming chat path.
 *
 * Returns the SSE Response immediately. All LLM work runs inside
 * ReadableStream.start() while the HTTP connection is already open.
 *
 * Cleanup (registry, context, tracking) happens in the stream's finally
 * block so it runs when the stream closes, not when the Response is returned.
 *
 * Event sequence:
 *   thinking → [auto_routed] → content deltas (Phase 1)
 *   → tool_start / tool_complete events (Phase 2 tool loop)
 *   → sub_agent_* events (concurrent sub-agent poller)
 *   → [local_tools_pending | more content deltas (final answer)]
 *   → [DONE]
 *   → (on error) error event → [DONE]
 */
/**
 * Streaming responses are not subject to the 30-second CPU limit once the
 * Response is returned — Cloudflare keeps the stream alive. We use two
 * cooperating timers:
 *
 *   INACTIVITY_TIMEOUT_MS (60s) — reset on every enqueue(). Fires only when
 *   the stream has been completely silent, indicating a genuinely stuck loop.
 *
 *   ABSOLUTE_TIMEOUT_MS (8min) — hard wall-clock cap regardless of activity,
 *   so runaway agents cannot hold connections open indefinitely.
 */

export function handleStreaming(ctx: ChatPipelineContext): Response {
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let lastActivityMs = Date.now();

      const enqueue = (data: string) => {
        lastActivityMs = Date.now();
        controller.enqueue(encoder.encode(`data: ${data}\n\n`));
      };

      let capturedUsage: CapturedUsage | null = null;
      let requestStatus: 'success' | 'error' | 'timeout' = 'success';
      let timedOut = false;
      let requestErrorType: string | undefined;
      let resolvedMessagesForMemory: AgentMessage[] | null = null;

      const fireTimeout = (elapsed_ms: number, reason: "inactivity" | "absolute") => {
        if (timedOut) return;
        timedOut = true;
        requestStatus = 'timeout';
        clearInterval(inactivityHandle);
        clearInterval(heartbeatHandle);
        clearTimeout(absoluteHandle);
        emit(ctx.env, ctx.ctx, {
          event:    'stream.timeout',
          severity: 'warn',
          userId:   ctx.userId,
          runId:    ctx.requestId,
          data:     { elapsed_ms, reason },
        });
        const message = reason === "inactivity"
          ? "The agent stopped responding for 60 seconds. The task may be stuck — try rephrasing or breaking it into smaller steps."
          : "Request exceeded the 8-minute limit. Try breaking the task into smaller steps.";
        try { enqueue(JSON.stringify({ type: "error", message })); } catch {}
        try { enqueue("[DONE]"); } catch {}
        try { controller.close(); } catch {}
      };

      // Inactivity check — fires every 15s, kills the stream if nothing was
      // emitted in the last INACTIVITY_TIMEOUT_MS ms.
      const inactivityHandle = setInterval(() => {
        if (Date.now() - lastActivityMs >= INACTIVITY_TIMEOUT_MS) {
          fireTimeout(Date.now() - lastActivityMs, "inactivity");
        }
      }, 15_000);

      // Absolute hard cap — no single request runs longer than 8 minutes.
      const absoluteHandle = setTimeout(
        () => fireTimeout(ABSOLUTE_TIMEOUT_MS, "absolute"),
        ABSOLUTE_TIMEOUT_MS
      );

      // Keepalive heartbeat — runs every HEARTBEAT_INTERVAL_MS while the LLM
      // is thinking. Sends a raw SSE comment (`:\n\n`) which:
      //   1. Resets lastActivityMs → inactivity timer never fires during a
      //      slow LLM response (e.g. large context, slow model, many tool schemas)
      //   2. Keeps the TCP connection alive through proxies and load balancers
      //      that close idle connections
      //   3. Is completely invisible to the frontend — aiService.ts only parses
      //      `data:` lines; SSE comments are discarded by the browser SSE spec
      //
      // This is what makes 1-2 hour agent tasks possible: each individual LLM
      // round can take several minutes without the stream being killed.
      const heartbeatHandle = setInterval(() => {
        if (timedOut) return;
        lastActivityMs = Date.now();
        try { controller.enqueue(encoder.encode(": keepalive\n\n")); } catch {}
      }, HEARTBEAT_INTERVAL_MS);

      // Signal immediately — tells the client the connection is open.
      // Include vision_substitutions when images were swapped to R2 presigned URLs
      // so the client can update its local message store and avoid re-uploading.
      enqueue(JSON.stringify({
        type: "thinking",
        ...(ctx.visionSubstitutions?.length
          ? { vision_substitutions: ctx.visionSubstitutions }
          : {}),
      }));

      if (ctx.autoRouterDecision) {
        enqueue(
          JSON.stringify({
            type: "auto_routed",
            tier: ctx.autoRouterDecision.tier,
            model: ctx.autoRouterDecision.model,
            usedFallback: ctx.autoRouterDecision.usedFallback,
            usedEmergency: (ctx.autoRouterDecision as any).usedEmergency,
          })
        );
      }

      try {
        const adapter = createProvider(ctx.provider, ctx.apiKey, ctx.apiBaseUrl, ctx.env, ctx.userId ?? undefined);

        // Non-tool models: stream directly, no agent loop needed.
        if (!ctx.supportsTools) {
          for await (const chunk of adapter.stream({
            model: ctx.modelId,
            messages: ctx.messages,
            temperature: ctx.body.temperature ?? 0.7,
            maxTokens: ctx.body.max_tokens,
            captureUsage: (u) => { capturedUsage = u; },
          })) {
            enqueue(sseChunk(ctx.body.model, chunk));
          }
          return;
        }

        // Build tool definitions for this turn.
        const registry = getRegistryById(ctx.requestId);
        const recentContextText = ctx.messages
          .filter((m) => m.role === "user" || m.role === "assistant")
          .slice(-5)
          .map((m) => {
            if (typeof m.content === "string") return m.content;
            if (Array.isArray(m.content)) {
              return (m.content as { type: string; text?: string }[])
                .filter((p) => p.type === "text")
                .map((p) => p.text ?? "")
                .join(" ");
            }
            return "";
          })
          .join(" ");

        const activeServers = new Set<string>();
        for (const m of ctx.messages) {
          if (m.role === "assistant" && m.tool_calls?.length) {
            for (const tc of m.tool_calls) {
              if (tc.function.name.startsWith("mcp_")) {
                const withoutPrefix = tc.function.name.slice(4);
                const sep = withoutPrefix.indexOf("__");
                if (sep !== -1) activeServers.add(withoutPrefix.slice(0, sep).toLowerCase());
              }
            }
          }
        }

        const canOfferExpand = getExpandCountSinceLastUser(ctx.messages) < 2;
        // STUDIO write-gate: strip the harness write/exec tools named in
        // STUDIO_HARNESS_BLOCKED from the main LLM's schema. (Transitional: the
        // coding specialists that used to own these were removed; the new agent
        // model will decide who gets write/exec access.)
        const rawToolDefs = [
          ...registry.getContextualDefinitions(ctx.localEngineConnected, {
            message: recentContextText || undefined,
            activeServers: activeServers.size > 0 ? activeServers : undefined,
            coreMode: "baseline",
          }),
          ...(canOfferExpand ? [EXPAND_TOOLS_DEFINITION] : []),
        ];
        const toolDefs = ctx.localEngineConnected
          ? rawToolDefs.filter((t) => !STUDIO_HARNESS_BLOCKED.has(t.function.name))
          : rawToolDefs;

        // ── Phase 1: direct streaming ──────────────────────────────────────
        const phase1 = await runPhase1(ctx, adapter, toolDefs, enqueue);
        capturedUsage = phase1.capturedUsage;

        // Phase 1 succeeded and the model answered directly — done.
        if (!phase1.directStreamFailed && phase1.toolCallsFromStream.length === 0) {
          return;
        }

        // Phase 1 failed after content was already sent — cannot restart.
        // Emit a structured error event so the client knows the stream ended abnormally,
        // then close. Without this, Studio sees a clean [DONE] and shows no error UI.
        if (phase1.directStreamFailed && phase1.directStreamHadContent) {
          emit(ctx.env, ctx.ctx, {
            event:    'stream.phase1.failed',
            severity: 'warn',
            userId:   ctx.userId,
            runId:    ctx.requestId,
            data:     { provider: ctx.provider, model: ctx.body.model },
          });
          try {
            enqueue(JSON.stringify({
              type: "error",
              message: "The response was interrupted. Please try again.",
            }));
          } catch { /* controller may already be closed */ }
          return;
        }

        // ── Phase 2: agent loop ────────────────────────────────────────────
        const phase2 = await runPhase2(
          ctx,
          adapter,
          toolDefs,
          phase1.toolCallsFromStream,
          capturedUsage,
          enqueue
        );
        if (!capturedUsage) capturedUsage = phase2.capturedUsage;
        resolvedMessagesForMemory = phase2.resolvedMessages;

      } catch (error: any) {
        logger.error("Streaming error", error);
        if (!timedOut) {
          requestStatus = 'error';
          const msg: string = error?.message ?? "";
          if (msg.includes("429") || msg.toLowerCase().includes("rate limit")) {
            requestErrorType = "rate_limit";
          } else if (msg.includes("401") || msg.toLowerCase().includes("unauthorized")) {
            requestErrorType = "auth_error";
          } else if (msg.includes("503") || msg.includes("502") || msg.includes("504")) {
            requestErrorType = "provider_unavailable";
          } else {
            requestErrorType = "agent_error";
          }
          emit(ctx.env, ctx.ctx, {
            event:    'provider.error',
            severity: 'error',
            userId:   ctx.userId,
            runId:    ctx.requestId,
            data: {
              provider:    ctx.provider,
              model:       ctx.body.model,
              requestType: 'chat',
              errorType:   requestErrorType,
              error:       error?.message ?? String(error),
            },
          });
        }
        try {
          enqueue(JSON.stringify({ type: "error", message: error?.message ?? "Agent error" }));
          const msg = error?.message ?? "";
          const userMsg =
            msg.includes("429") || msg.toLowerCase().includes("rate limit")
              ? "Rate limit reached. Please wait a moment and try again."
              : msg.includes("401") || msg.toLowerCase().includes("unauthorized")
              ? "Authentication error. Please check your API key in Settings."
              : "Something went wrong. Please try again.";
          enqueue(sseChunk(ctx.body.model, userMsg));
        } catch { /* controller may already be closed */ }
      } finally {
        clearInterval(inactivityHandle);
        clearInterval(heartbeatHandle);
        clearTimeout(absoluteHandle);
        try { enqueue("[DONE]"); } catch {}
        try { controller.close(); } catch {}

        // Cleanup must happen here (not in the outer coordinator) because the
        // coordinator's finally runs when the Response is returned, which is
        // before the stream is consumed.
        clearRequestRegistry(ctx.requestId);
        clearRequestContext(ctx.requestId);
        // agentContext (AgentContextDO) removed — no cleanup needed

        if (ctx.autoRouter && ctx.autoRouterDecision) {
          try { await ctx.autoRouter.recordRequest(ctx.autoRouterDecision); } catch {}
        }

        // Fire-and-forget memory processing (only on success, not on error/timeout)
        if (requestStatus === 'success' && resolvedMessagesForMemory) {
          fireMemoryProcess(ctx, resolvedMessagesForMemory);
        }
      }
    },
  });

  return addCORSHeaders(
    new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    })
  );
}
