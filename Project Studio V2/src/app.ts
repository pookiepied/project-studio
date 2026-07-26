import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

import { resolveProviderConfig } from "./models/provider-config.js";
import {
  bootstrapModelProviders,
  resolveGatewayAuthMode,
} from "./models/bootstrap.js";
import { initializeObservability } from "./observability/index.js";

// Provider selection is validated and bootstrapped before OpenTelemetry
// starts, so an unavailable/invalid model source rejects cleanly instead of
// leaving a partially initialized SDK behind.
const providerConfig = resolveProviderConfig();
bootstrapModelProviders(providerConfig);

const observability = initializeObservability();

// Reported after the logger exists. A development bootstrap token overrides a
// real signed-in session, so which one is in force must be visible rather than
// inferred from environment variables.
if (providerConfig.source === "studio-cloud") {
  observability.logger.info("Studio gateway authentication configured", {
    mode: resolveGatewayAuthMode(),
  });
}

const app = new Hono();
app.route("/", flue());

export default app;
