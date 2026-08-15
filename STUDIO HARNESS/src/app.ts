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
  type ObservabilityHandle,
} from "./observability/index.js";
import { createHttpApp } from "./transport/http/create-app.js";
import { closeDatabase } from "./storage/database.js";

interface HarnessApplication {
  readonly app: ReturnType<typeof createHttpApp>;
  readonly shutdown: () => Promise<void>;
}

function createHarnessApplication(): HarnessApplication {
  let observability: ObservabilityHandle | undefined;
  let admission: ReturnType<typeof createAdmissionSession> | undefined;
  let studioRuntime: StudioRuntime | undefined;

  try {
    // Provider selection is validated and bootstrapped before OpenTelemetry
    // starts, so an unavailable/invalid model source rejects cleanly instead of
    // leaving a partially initialized SDK behind.
    const providerConfig = resolveProviderConfig();
    bootstrapModelProviders(providerConfig);

    observability = initializeObservability();

    const bootstrapCredential = admissionCredentialFromEnvironment(
      process.env.PROJECT_STUDIO_ADMISSION_CREDENTIAL,
    );
    admission = createAdmissionSession({
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
    const runtime = new StudioRuntime({
      logger: observability.logger,
      approver: approvals,
      clientId: admission.context.clientId,
      sessionId: admission.context.sessionId,
    });
    studioRuntime = runtime;
    configureStudioRuntime(runtime);
    registerFlueTurnBoundary(() => runtime.prepareModelTurn());
    void runtime.start().catch(() => {
      observability?.logger.error(
        "MCP startup reconciliation failed; inspect server status for details.",
      );
    });

    // Reported after the logger exists. A development bootstrap token overrides
    // a real signed-in session, so which one is in force must be visible rather
    // than inferred from environment variables.
    if (providerConfig.source === "studio-cloud") {
      observability.logger.info("Studio gateway authentication configured", {
        mode: resolveGatewayAuthMode(),
      });
    }

    const app = createHttpApp({
      runtime,
      approvals,
      admission: admission.verifier,
    });

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = (): Promise<void> => {
      shutdownPromise ??= (async () => {
        admission?.verifier.invalidate();
        try {
          runtime.stop();
        } finally {
          closeDatabase();
          await observability?.shutdown();
        }
      })();
      return shutdownPromise;
    };

    return { app, shutdown };
  } catch (error) {
    // Startup is a transaction: anything opened before a later composition
    // failure is closed before the error escapes to the process supervisor.
    admission?.verifier.invalidate();
    try {
      studioRuntime?.stop();
    } finally {
      closeDatabase();
      if (observability !== undefined) {
        void observability.shutdown().catch(() => undefined);
      }
    }
    throw error;
  }
}

const { app, shutdown } = createHarnessApplication();

process.once("SIGTERM", () => {
  void shutdown();
});

export default app;
