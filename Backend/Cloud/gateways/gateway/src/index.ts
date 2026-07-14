import { Hono } from "hono";
import type { GatewayEnv, GatewayWorkerEnv } from "./env";
import { handleChatCompletions } from "./routes/chat";
import { getModelSyncService } from "./services/modelSync";

import { handleModels }                              from "./routes/models";
import { handleModes }                               from "./routes/modes";
import { handleGetAdminModes, handlePutAdminModes }  from "./routes/adminModes";
import { handleTranscription }                       from "./routes/audio";
import { handleTTS }                                 from "./routes/tts";
import { handleInternalStt }                         from "./routes/internalStt";
import { handleImageGenerate }                        from "./routes/imageGenerate";
import { handleEmbeddings }                           from "./routes/embeddings";
import { handleRerank }                               from "./routes/rerank";
import { handleProviderBalance }                      from "./routes/providerBalance";
import { handleVideoGenerate, handleVideoStatus }     from "./routes/videoGenerate";
import { handleRateCheck, handleRateRecord }          from "./routes/rateTracker";

export { RateTrackerDurableObject } from "./durable/RateTrackerDurableObject";

const CRON_MODEL_SYNC = "0 */6 * * *";

const app = new Hono<{ Bindings: GatewayWorkerEnv }>();

app.get("/health", (c) =>
  c.json({
    status:    "ok",
    worker:    "studio-gateway",
    timestamp: new Date().toISOString(),
    version:   "1.0.0",
  }),
);

// OpenAI-compatible chat completions — primary gateway route.
// Accepts model in "provider:model-id" format and proxies to the appropriate provider.
app.post("/v1/chat/completions", (c) =>
  handleChatCompletions(c.req.raw, c.env, c.executionCtx),
);

// Model catalog — lists enabled provider models.
app.get("/v1/models", (c) => handleModels(c.req.raw, c.env));

// Modes config — active persona/mode for the current user.
app.get("/v1/modes", (c) => handleModes(c.env));

// Admin: modes + auto-router config (stored in MCP_KV).
app.get("/v1/admin/modes-config", (c) => handleGetAdminModes(c.req.raw, c.env));
app.put("/v1/admin/modes-config", (c) => handlePutAdminModes(c.req.raw, c.env));

// Audio — transcription (Whisper) and TTS.
app.post("/v1/audio/transcriptions", (c) => handleTranscription(c.req.raw, c.env, c.executionCtx));
app.post("/v1/audio/speech",         (c) => handleTTS(c.req.raw, c.env, c.executionCtx));

// Image generation — routes to fal, openrouter, or openai.
app.post(  "/v1/images/generate",     (c) => handleImageGenerate(c.req.raw, c.env, c.executionCtx));

// Video generation — async submit + polling.
app.post(  "/v1/videos/generate",     (c) => handleVideoGenerate(c.req.raw, c.env, c.executionCtx));
app.get(   "/v1/videos/status/:jobId",(c) => handleVideoStatus(c.req.param("jobId"), c.env));

// Embeddings — multi-provider text embedding (OpenAI-compatible response format).
app.post("/v1/embeddings", (c) => handleEmbeddings(c.req.raw, c.env, c.executionCtx));

// Reranking — Cohere, Bedrock, OpenRouter.
app.post("/v1/rerank", (c) => handleRerank(c.req.raw, c.env, c.executionCtx));

// Provider balance — returns remaining credit/balance for a provider.
app.get("/v1/provider-balance/:provider", (c) => handleProviderBalance(c.req.param("provider"), c.env));

// Internal STT relay — service binding only (youtube-transcript-mcp).
// Returns 404 to public callers to avoid leaking the path.
app.post("/internal/stt", async (c) => {
  const isServiceBinding = c.req.header("x-service-binding") === "1"
    || !c.req.header("origin");
  if (!isServiceBinding) return new Response("Not Found", { status: 404 });
  return handleInternalStt(c.req.raw, c.env);
});

// Internal rate-tracking endpoints — service binding only (chat → gateway → DO).
app.get("/internal/rate/check",  (c) => handleRateCheck(c.req.query("provider") ?? "", c.env));
app.post("/internal/rate/record", (c) => handleRateRecord(c.req.query("provider") ?? "", c.env));

app.all("*", (c) =>
  c.json({ error: { message: "Not Found", type: "not_found" } }, 404),
);

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: GatewayWorkerEnv, ctx: ExecutionContext) {
    if (event.cron === CRON_MODEL_SYNC) {
      ctx.waitUntil(getModelSyncService().syncModels(env));
    }
  },
};
