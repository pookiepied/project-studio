import { Hono } from "hono";
import type { Env } from "./system/env";
import { healthRoute } from "./server/routes/health";
import { conversationsRoute } from "./server/routes/conversations";
import { uploadsRoute } from "./server/routes/uploads";
import { artifactsRoute } from "./server/routes/artifacts";
import { plansRoute } from "./server/routes/plans";
import { transcriptsRoute } from "./server/routes/transcripts";
import { objectsRoute } from "./server/routes/objects";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/conversations", conversationsRoute);
app.route("/uploads", uploadsRoute);
app.route("/artifacts", artifactsRoute);
app.route("/plans", plansRoute);
app.route("/transcripts", transcriptsRoute);
app.route("/objects", objectsRoute);

app.onError((error, c) => {
  console.error(error);
  if (error instanceof Error && error.message === "conversation_not_found") {
    return c.json({ error: "conversation_not_found" }, 404);
  }
  if (error instanceof Error && error.message === "previous_artifact_not_found") {
    return c.json({ error: "previous_artifact_not_found" }, 404);
  }
  if (error instanceof Error && error.message === "artifact_conversation_mismatch") {
    return c.json({ error: "artifact_conversation_mismatch" }, 400);
  }
  if (error instanceof Error && (
    error.message.startsWith("invalid_artifact_") ||
    error.message.endsWith("_required") ||
    error.message === "artifact_version_not_found"
  )) {
    return c.json({ error: error.message }, 400);
  }
  const exposeMessage = c.env.ENVIRONMENT !== "production";
  return c.json({
    error: "internal_error",
    message: exposeMessage && error instanceof Error ? error.message : "Unexpected Studio Data error",
  }, 500);
});

export default app;
