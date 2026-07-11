import { Hono } from "hono";
import type { Env } from "./system/env";
import { healthRoute } from "./server/routes/health";
import { conversationsRoute } from "./server/routes/conversations";
import { uploadsRoute } from "./server/routes/uploads";
import { artifactsRoute } from "./server/routes/artifacts";

const app = new Hono<{ Bindings: Env }>();

app.route("/health", healthRoute);
app.route("/conversations", conversationsRoute);
app.route("/uploads", uploadsRoute);
app.route("/artifacts", artifactsRoute);

export default app;
