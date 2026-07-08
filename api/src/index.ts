/// <reference types="@cloudflare/workers-types" />
/**
 * API Gateway - Main Application Entry Point
 *
 * Centralized API gateway for routing requests to AI workers,
 * managing jobs, and handling system authentication.
 *
 * Also exports a scheduled handler that runs the stale job reaper
 * on a cron trigger (see wrangler.toml [triggers] section).
 */

import { Hono } from 'hono';
import { Env, Caller } from './types';
import { verifyToken } from '@studio/jwt';
import { corsMiddleware, securityHeaders, requestId, requestLogger, requestSizeLimit } from './middleware/security';
import { healthRoutes } from './routes/health';
import { openaiAdapterRoutes } from './routes/adapters/openai';
import { jobRoutes } from './routes/jobs';
import { taskRoutes } from './routes/tasks';
import { engineRoutes } from './routes/engine';
import { updateRoutes } from './routes/updates';
import { runStaleJobReaper } from './services/reaper';
import { trackerRoutes }  from './routes/tracker';
import { studioRoutes }   from './routes/studio';
import { skillRoutes }    from './routes/skills';
import { connectorRoutes } from './routes/connectors';
import { emit } from './tracking';

type Variables = {
  caller: Caller;
  requestId: string;
};

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// Apply security middleware
app.use('/*', requestId);
app.use('/*', requestLogger);
app.use('/*', corsMiddleware());
app.use('/*', securityHeaders);
app.use('/*', requestSizeLimit);

// Register route handlers
app.route('/', healthRoutes);
app.route('/', openaiAdapterRoutes);
app.route('/', studioRoutes);
app.route('/', connectorRoutes);
app.route('/', skillRoutes);
app.route('/', trackerRoutes);
app.route('/', jobRoutes);
app.route('/', taskRoutes);
app.route('/', engineRoutes);
app.route('/', updateRoutes);

export default {
  /**
   * Main fetch handler.
   *
   * WebSocket upgrade requests and all /agents/* paths are forwarded directly
   * to the AI worker (service binding) BEFORE Hono processes the request.
   * This is required because:
   *   1. WebSocket upgrades (Upgrade: websocket) need a raw 101 response —
   *      Hono middleware cannot intercept or proxy them transparently.
   *   2. The Cloudflare Agents SDK's routeAgentRequest() in the AI worker
   *      handles /agents/{class}/{id} to reach ChatAgent DOs.
   *   3. Browsers cannot set custom Authorization headers on WebSocket connects,
   *      so auth for the agent path is handled inside ChatAgent itself.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/agents/")) {
      // WebSocket connections cannot carry Authorization headers (browser limitation).
      // Extract the user identity from the Bearer JWT in the Authorization header
      // (present on HTTP agent calls) or from the cf-access-jwt-assertion header
      // (set by Cloudflare Access on all requests), then forward as X-User-ID so
      // the ChatAgent can scope memory and state correctly.
      const forwarded = new Request(request);
      try {
        let userId: string | null = null;

        // Path 1 — Bearer JWT from Authorization header (HTTP agent calls, not WS).
        // Cryptographically verified — a forged token is rejected here.
        const auth = request.headers.get("Authorization") ?? "";
        if (auth.startsWith("Bearer ") && env.JWT_SECRET) {
          const payload = await verifyToken(auth.slice(7), env.JWT_SECRET);
          userId = payload?.sub ?? null;
        }

        // Path 2 — Cloudflare Access JWT (present on every request including WS upgrades).
        // CF Access tokens are verified by Cloudflare's infrastructure before reaching us,
        // so we trust the payload claims here. We still decode without re-verifying the
        // signature since we don't hold the CF Access public key in this worker.
        if (!userId) {
          const accessJwt = request.headers.get("cf-access-jwt-assertion") ?? "";
          if (accessJwt) {
            const parts = accessJwt.split(".");
            if (parts.length === 3) {
              const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
              const padded = b64 + "=".repeat((4 - b64.length % 4) % 4);
              const payload = JSON.parse(atob(padded));
              userId = payload?.sub ?? payload?.email ?? null;
            }
          }
        }

        if (userId) {
          const headers = new Headers(request.headers);
          headers.set("X-User-ID", userId);
          return env.AI.fetch(new Request(request, { headers }));
        }
      } catch { /* ignore decode errors — forward without user ID */ }

      return env.AI.fetch(request);
    }

    return app.fetch(request, env, ctx);
  },

  /**
   * Cron handler — runs on the schedule defined in wrangler.toml.
   * Resets stale running jobs back to 'queued' so they can be reclaimed
   * after an engine crash or restart.
   */
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    if (event.cron === '* * * * *') {
      ctx.waitUntil(
        runStaleJobReaper(env).then((result) => {
          if (result.reset > 0) {
            console.log(`[Reaper] Reset ${result.reset} stale job(s) at ${result.checkedAt}`);
            emit(env, ctx, {
              event: 'job.reaper.reset', severity: 'warn',
              data: { reset: result.reset, checkedAt: result.checkedAt },
            });
          }
          if (result.deadLetters > 0) {
            emit(env, ctx, {
              event: 'job.reaper.dead_lettered', severity: 'warn',
              data: { count: result.deadLetters, checkedAt: result.checkedAt },
            });
          }
        })
      );
    }
  },
};
