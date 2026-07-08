import { routeAgentRequest } from "agents";
import { Hono } from "hono";
import { Env } from "./env";
import { API_PREFIX } from "@gateway/config/constants";
import { handleCORS, addCORSHeaders } from "@gateway/middleware/cors";
import { handleError } from "./server/middleware/errors";
import { createErrorResponse } from "@gateway/middleware/response";
import { handleChat } from "./server/routes/chat";
import { handleModes } from "@gateway/routes/modes";
import { handleGetAdminModes, handlePutAdminModes } from "@gateway/routes/adminModes";
import { handleHealth } from "./server/routes/health";
import { handleImageServe, handleImageDelete, cleanupExpiredImages, cleanupExpiredTempImages } from "@gateway/routes/images";
import { handlePDFUpload, handlePDFDelete } from "./server/routes/pdf";
import { handleDocsIndex, handleDocsDelete, cleanupExpiredDocs } from "./server/routes/docs";
import { handleDocumentUpload, handleDocumentUploadDelete, cleanupExpiredDocUploads } from "./server/routes/upload";
import { handleKbList, handleKbIndex, handleKbDelete } from "./server/routes/kb";
import { handleLocalChatSave, handleToolExecute } from "./server/routes/local";
import { handleListMemories, handleDeleteMemory } from "./server/routes/memories";
import { fetchAllCredits } from "./tracking";
import { isOriginAllowed } from "./server/utils/accessControl";
import { recordTelemetryEvent } from "./tracking/telemetry";

// ---------------------------------------------------------------------------
// Durable Object exports — Cloudflare Agents SDK
// ---------------------------------------------------------------------------
export { ChatAgent } from "./agent/ChatAgent";

// ---------------------------------------------------------------------------
// Hono app — handles all HTTP routes after routeAgentRequest() runs first.
// routeAgentRequest() is called in the fetch handler below; it intercepts
// /agents/* WebSocket connections before Hono ever sees the request.
// ---------------------------------------------------------------------------
type Variables = { isServiceBinding: boolean };

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ── Middleware 1: Service binding detection ──────────────────────────────────
// Internal Worker-to-Worker calls arrive with hostname 'internal'.
// In dev/preview environments they may arrive via .workers.dev subdomains.
// Service bindings bypass origin validation and the auth gate.
app.use("/*", async (c, next) => {
  const url = new URL(c.req.url);
  c.set(
    "isServiceBinding",
    url.hostname === "internal" || url.hostname.includes("workers.dev")
  );
  await next();
});

// ── Middleware 2: CORS ───────────────────────────────────────────────────────
// OPTIONS preflights resolve here — before auth — so browsers get 204 without
// needing credentials. All other responses get CORS headers added after the
// route handler runs. Streaming responses are safe: addCORSHeaders passes the
// ReadableStream body reference through without consuming it.
app.use("/*", async (c, next) => {
  const preflight = handleCORS(c.req.raw);
  if (preflight) return preflight;
  await next();
  c.res = addCORSHeaders(c.res, c.req.raw);
});

// ── Middleware 3: Origin validation (public requests only) ───────────────────
app.use("/*", async (c, next) => {
  if (!c.get("isServiceBinding")) {
    const origin = c.req.header("origin") ?? null;
    if (!isOriginAllowed(origin)) {
      return createErrorResponse(
        "Access denied. Invalid origin.",
        403,
        "access_denied_error",
        c.req.raw
      );
    }
  }
  await next();
});

// ── Middleware 4: Auth gate (production, public requests only) ───────────────
// Requires a Cloudflare Access JWT assertion or a Bearer token.
// Full token verification happens in extractUserContext — the chat handler
// rejects the request if no userId resolves from a valid JWT.
app.use("/*", async (c, next) => {
  if (c.env.ENVIRONMENT === "production" && !c.get("isServiceBinding")) {
    const assertion = c.req.header("cf-access-jwt-assertion");
    const auth      = c.req.header("Authorization");
    if (!assertion && !auth) {
      return createErrorResponse(
        "Access denied. Authentication required.",
        401,
        "unauthorized_error",
        c.req.raw
      );
    }
  }
  await next();
});

// ── Routes ───────────────────────────────────────────────────────────────────

app.post(`${API_PREFIX}/chat/completions`,   (c) => handleChat(c.req.raw, c.env, c.executionCtx, c.get("isServiceBinding")));
app.get(`${API_PREFIX}/health`,              (c) => handleHealth(c.env));
app.get(`${API_PREFIX}/modes`,               (c) => handleModes(c.env));
app.get(`${API_PREFIX}/admin/modes-config`,  (c) => handleGetAdminModes(c.req.raw, c.env));
app.put(`${API_PREFIX}/admin/modes-config`,  (c) => handlePutAdminModes(c.req.raw, c.env));

app.get(`${API_PREFIX}/images/:id`,          (c) => handleImageServe(c.req.param("id"), c.env));
app.delete(`${API_PREFIX}/delete-image/:id`, (c) => handleImageDelete(c.req.param("id"), c.env));

app.post(`${API_PREFIX}/pdf/upload`, (c) => handlePDFUpload(c.req.raw, c.env));
app.delete(`${API_PREFIX}/pdf/:id`,  (c) => handlePDFDelete(c.req.param("id"), c.env));

app.post(`${API_PREFIX}/upload/document`,         (c) => handleDocumentUpload(c.req.raw, c.env));
app.delete(`${API_PREFIX}/upload/document/:docId`, (c) => handleDocumentUploadDelete(c.req.param("docId"), c.env));

app.post(`${API_PREFIX}/docs/index`, (c) => handleDocsIndex(c.req.raw, c.env, c.executionCtx));
app.delete(`${API_PREFIX}/docs/:sessionId/:docId`, (c) =>
  handleDocsDelete(c.req.param("docId"), c.req.param("sessionId"), c.env)
);

app.get(`${API_PREFIX}/kb`,            (c) => handleKbList(c.req.raw, c.env));
app.post(`${API_PREFIX}/kb/index`,     (c) => handleKbIndex(c.req.raw, c.env, c.executionCtx));
app.delete(`${API_PREFIX}/kb/:docId`,  (c) => handleKbDelete(c.req.param("docId"), c.req.raw, c.env));

app.post(`${API_PREFIX}/local/chat/save`,    (c) => handleLocalChatSave(c.req.raw, c.env, c.executionCtx));
app.post(`${API_PREFIX}/local/tool/execute`, (c) => handleToolExecute(c.req.raw, c.env));

app.get(`${API_PREFIX}/user/memories`,        (c) => handleListMemories(c.req.raw, c.env));
app.delete(`${API_PREFIX}/user/memories/:id`, (c) => handleDeleteMemory(c.req.param("id"), c.req.raw, c.env));

// ── 404 fallback ─────────────────────────────────────────────────────────────
app.all("/*", () => new Response("Not Found", { status: 404 }));

// ---------------------------------------------------------------------------
// Worker export
// ---------------------------------------------------------------------------
export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    // routeAgentRequest MUST run before Hono.
    // It intercepts /agents/{class}/{id} paths for WebSocket upgrades and HTTP
    // requests to ChatAgent Durable Objects.
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) return agentResponse;

    try {
      return await app.fetch(request, env, ctx);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      recordTelemetryEvent(env, {
        type: "unhandled_error",
        detail: new URL(request.url).pathname,
        errorMessage: errMsg,
      });
      return addCORSHeaders(handleError(err as Error), request);
    }
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    if (event.cron === "*/15 * * * *") {
      ctx.waitUntil(
        Promise.all([
          cleanupExpiredTempImages(env),
          fetchAllCredits(env).catch(() => {}),
        ])
      );
    } else if (event.cron === "0 2 * * *") {
      const trackerCleanup = env.TRACKER
        ? env.TRACKER.fetch("https://tracker/usage/cleanup", { method: "DELETE" }).catch(() => {})
        : Promise.resolve();
      ctx.waitUntil(
        Promise.all([
          trackerCleanup,
          cleanupExpiredImages(env),
          cleanupExpiredDocs(env),
          cleanupExpiredDocUploads(env),
        ])
      );
    }
  },
};
