import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

import { resolveProviderConfig } from "./models/provider-config.js";
import { bootstrapModelProviders } from "./models/bootstrap.js";
import { initializeObservability } from "./observability/index.js";

// Provider selection is validated and bootstrapped before OpenTelemetry
// starts, so an unavailable/invalid model source rejects cleanly instead of
// leaving a partially initialized SDK behind.
const providerConfig = resolveProviderConfig();
bootstrapModelProviders(providerConfig);

initializeObservability();

const app = new Hono();
app.route("/", flue());

export default app;
