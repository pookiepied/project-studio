import { Hono } from "hono";
import { chatRoute } from "./llm/features/chat/route";
import { audioRoute } from "./llm/features/audio/route";
import { embeddingsRoute } from "./llm/features/embeddings/route";
import { imagesRoute } from "./llm/features/images/route";
import { videoRoute } from "./llm/features/video/route";
import { modelsRoute } from "./llm/discovery/route";
import { creditsRoute } from "./llm/features/credits/route";
import { healthRoute } from "./system/health/route";
import type { GatewayEnv } from "./system/infrastructure/cloudflare/env";
import { scheduledDiscovery } from "./llm/discovery/schedule";

const app = new Hono<{ Bindings: GatewayEnv }>();

app.route("/health", healthRoute);
app.route("/v1/chat/completions", chatRoute);
app.route("/v1/embeddings", embeddingsRoute);
app.route("/v1/audio", audioRoute);
app.route("/v1/images", imagesRoute);
app.route("/v1/videos", videoRoute);
app.route("/v1/models", modelsRoute);
app.route("/v1/credits", creditsRoute);

app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "Route not found." } }, 404));

export default {
  fetch: app.fetch,
  async scheduled(_event: ScheduledEvent, env: GatewayEnv, ctx: ExecutionContext) {
    ctx.waitUntil(scheduledDiscovery(env));
  }
};
