import {
  admissionCredentialFromEnvironment,
} from "./admission/verifier.js";
import { createAdmissionSession } from "./admission/verifier.js";
import { PermissionApprovalBroker } from "./application/approval-broker.js";
import { PendingApprovalStore } from "./permissions/pending-approvals.js";
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
import { reportNodeRuntime } from "./platform/runtime.js";
import { createHttpApp } from "./transport/http/create-app.js";
import { openDatabase, type StudioDatabase } from "./storage/database.js";
import { KeyringCredentialStore } from "./credentials/keyring-store.js";
import { ConnectionStore } from "./providers/connection-store.js";
import { ModelCatalog } from "./providers/model-catalog.js";
import { ProviderManagementService } from "./application/provider-management.js";

interface HarnessApplication {
  readonly app: ReturnType<typeof createHttpApp>;
  readonly shutdown: () => Promise<void>;
}

function createHarnessApplication(): HarnessApplication {
  let observability: ObservabilityHandle | undefined;
  let admission: ReturnType<typeof createAdmissionSession> | undefined;
  let studioRuntime: StudioRuntime | undefined;
  let database: StudioDatabase | undefined;

  try {
    // This function is the composition root: it opens the one connection the
    // server uses, hands it to everything that needs one, and is the only
    // thing that closes it.
    database = openDatabase();

    // Provider selection is validated and bootstrapped before OpenTelemetry
    // starts, so an unavailable/invalid model source rejects cleanly instead of
    // leaving a partially initialized SDK behind.
    const providerConfig = resolveProviderConfig();
    bootstrapModelProviders(providerConfig, { database });

    observability = initializeObservability();

    // Said out loud on every start, because the alternative was a number in a
    // file nobody reads. `.node-version` and `engines` were both unenforced —
    // no CI, no version manager — so the whole Stage 4 cycle was measured on a
    // runtime below the floor our dependencies declare, and nothing said so
    // (meta-task #79).
    reportNodeRuntime(observability.logger);

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

    // Durable: an unanswered question survives a restart and is asked again
    // rather than disappearing with the process (ADR 0036).
    const approvals = new PermissionApprovalBroker({
      store: new PendingApprovalStore(database),
    });
    const runtime = new StudioRuntime({
      database,
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

    // Same database, same construction style as `servers`: the provider
    // surface is composed here so the connection it reads from is the one this
    // root owns and closes. Keys go to the OS credential store, never the
    // database, which is ConnectionStore's own rule to enforce.
    const providerConnections = new ConnectionStore({
      db: database,
      credentials: new KeyringCredentialStore(),
    });
    const providers = new ProviderManagementService({
      connections: providerConnections,
      catalog: new ModelCatalog({
        db: database,
        connections: providerConnections,
      }),
    });

    const app = createHttpApp({
      servers: runtime.servers,
      providers,
      approvals,
      admission: admission.verifier,
    });

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = (): Promise<void> => {
      shutdownPromise ??= (async () => {
        admission?.verifier.invalidate();
        try {
          // Awaited: MCP servers run in the project directory, and returning
          // before they are gone leaves them orphaned.
          await runtime.stop();
        } finally {
          database?.close();
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
      void studioRuntime?.stop();
    } finally {
      database?.close();
      if (observability !== undefined) {
        void observability.shutdown().catch(() => undefined);
      }
    }
    throw error;
  }
}

const { app, shutdown } = createHarnessApplication();

/**
 * Graceful shutdown.
 *
 * `SIGTERM` is not deliverable on Windows — `process.kill` there maps to
 * `TerminateProcess`, which ends the process without running a handler. So the
 * database was never closed and its WAL never checkpointed, leaving a hot
 * `-wal` beside every stopped harness. `SIGINT` and `SIGBREAK` do arrive on
 * Windows, and the parent-owned `shutdown` message works regardless of
 * platform, so a supervisor always has one way to ask.
 */
for (const signal of ["SIGTERM", "SIGINT", "SIGBREAK"] as const) {
  process.once(signal, () => {
    void shutdown().finally(() => process.exit(0));
  });
}

process.on("message", (message) => {
  if (message === "shutdown") void shutdown().finally(() => process.exit(0));
});

export default app;
