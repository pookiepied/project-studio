import {
  admissionCredentialFromEnvironment,
} from "./admission/verifier.js";
import { createAdmissionSession } from "./admission/verifier.js";
import { PermissionApprovalBroker } from "./application/approval-broker.js";
import {
  configureStudioRuntime,
  StudioRuntime,
} from "./application/studio-runtime.js";
import { resolveProviderConfig } from "./models/provider-config.js";
import {
  bootstrapModelProviders,
  resolveGatewayAuthMode,
} from "./models/bootstrap.js";
import {
  initializeObservability,
  registerFlueTurnBoundary,
} from "./observability/index.js";
import { createHttpApp } from "./transport/http/create-app.js";

// Provider selection is validated and bootstrapped before OpenTelemetry
// starts, so an unavailable/invalid model source rejects cleanly instead of
// leaving a partially initialized SDK behind.
const providerConfig = resolveProviderConfig();
bootstrapModelProviders(providerConfig);

const observability = initializeObservability();

const bootstrapCredential = admissionCredentialFromEnvironment(
  process.env.PROJECT_STUDIO_ADMISSION_CREDENTIAL,
);
const admission = createAdmissionSession({
  ...(bootstrapCredential === undefined ? {} : { credential: bootstrapCredential }),
  ...(process.env.PROJECT_STUDIO_ADMISSION_CLIENT_ID === undefined
    ? {}
    : { clientId: process.env.PROJECT_STUDIO_ADMISSION_CLIENT_ID }),
  clientType: "studio-host",
  ...(process.env.PROJECT_STUDIO_ADMISSION_SESSION_ID === undefined
    ? {}
    : { sessionId: process.env.PROJECT_STUDIO_ADMISSION_SESSION_ID }),
});

const approvals = new PermissionApprovalBroker();
const studioRuntime = new StudioRuntime({
  logger: observability.logger,
  approver: approvals,
  clientId: admission.context.clientId,
  sessionId: admission.context.sessionId,
});
configureStudioRuntime(studioRuntime);
registerFlueTurnBoundary(() => studioRuntime.prepareModelTurn());
void studioRuntime.start().catch(() => {
  observability.logger.error("MCP startup reconciliation failed; inspect server status for details.");
});

// Reported after the logger exists. A development bootstrap token overrides a
// real signed-in session, so which one is in force must be visible rather than
// inferred from environment variables.
if (providerConfig.source === "studio-cloud") {
  observability.logger.info("Studio gateway authentication configured", {
    mode: resolveGatewayAuthMode(),
  });
}

const app = createHttpApp({
  runtime: studioRuntime,
  approvals,
  admission: admission.verifier,
});

process.once("SIGTERM", () => {
  admission.verifier.invalidate();
  studioRuntime.stop();
  void observability.shutdown();
});

export default app;
