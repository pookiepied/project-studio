import { Hono } from "hono";
import { audioRoute } from "@/features/audio/route";
import { chatRoute } from "@/features/chat/route";
import { embeddingsRoute } from "@/features/embeddings/route";
import { healthRoute } from "@/features/health/route";
import { imagesRoute } from "@/features/images/route";
import { modelsRoute } from "@/features/models/route";
import { videoRoute } from "@/features/videos/route";
import { handleError, handleNotFound } from "./errorHandlers";
import { requestIdMiddleware } from "./middleware/requestId";
import type { GatewayApp } from "./types";

export function createGatewayApp() {
  const app = new Hono<GatewayApp>();

  app.use("*", requestIdMiddleware);
  app.route("/health", healthRoute);
  app.route("/v1/chat/completions", chatRoute);
  app.route("/v1/embeddings", embeddingsRoute);
  app.route("/v1/audio", audioRoute);
  app.route("/v1/images", imagesRoute);
  app.route("/v1/videos", videoRoute);
  app.route("/v1/models", modelsRoute);
  app.notFound(handleNotFound);
  app.onError(handleError);

  return app;
}
