import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

import { initializeObservability } from "./observability/index.js";

initializeObservability();

const app = new Hono();
app.route("/", flue());

export default app;
