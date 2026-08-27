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
import { bootstrapModelProviders } from "./models/bootstrap.js";
import {
  initializeObservability,
  registerFlueTurnBoundary,
  type ObservabilityHandle,
} from "./observability/index.js";
import { bootLog } from "./platform/boot-log.js";
import { reportNodeRuntime } from "./platform/runtime.js";
import {
  createStudioTransientModelRetryPolicy,
  installTransientModelRetryPolicy,
} from "./reliability/model-retry-policy.js";
import { createHttpApp } from "./transport/http/create-app.js";
import { openDatabase, type StudioDatabase } from "./storage/database.js";
import { KeyringCredentialStore } from "./credentials/keyring-store.js";
import { ConnectionStore } from "./providers/connection-store.js";
import { ModelCatalog } from "./providers/model-catalog.js";
import { ProviderManagementService } from "./application/provider-management.js";
import { RetrievalManagementService } from "./application/retrieval-management.js";
import { RetrievalSettingsStore } from "./retrieval/settings.js";
import { ConversationStore } from "./conversations/store.js";
import { ProjectStore } from "./projects/store.js";

interface HarnessApplication {
  readonly app: ReturnType<typeof createHttpApp>;
  readonly shutdown: () => Promise<void>;
}

function createHarnessApplication(): HarnessApplication {
  bootLog("composition root entered");
  let observability: ObservabilityHandle | undefined;
  let admission: ReturnType<typeof createAdmissionSession> | undefined;
  let studioRuntime: StudioRuntime | undefined;
  let database: StudioDatabase | undefined;

  try {
    // This function is the composition root: it opens the one connection the
    // server uses, hands it to everything that needs one, and is the only
    // thing that closes it.
    bootLog("step 1: openDatabase() entering");
    database = openDatabase();
    bootLog("step 1: openDatabase() completed");

    // Provider selection is validated and bootstrapped before OpenTelemetry
    // starts, so an unavailable/invalid model source rejects cleanly instead of
    // leaving a partially initialized SDK behind.
    bootLog("step 2: resolveProviderConfig() and bootstrapModelProviders() entering");
    const providerConfig = resolveProviderConfig();
    bootstrapModelProviders(providerConfig, { database });
    bootLog("step 2: resolveProviderConfig() and bootstrapModelProviders() completed");

    // The patched runtime owns the transient-retry loop but not its budget:
    // the per-class table lives in src/reliability/model-retry-policy.ts, and
    // this publication is how the bundle reaches it — it cannot import our
    // modules (it executes from pnpm's virtual store), so it reads the policy
    // off globalThis at each retry decision. Installed here because this is
    // the composition root, before any session or MCP server can run; until
    // it fires the bundle keeps its own shipped constants.
    bootLog("step 3: installTransientModelRetryPolicy() entering");
    installTransientModelRetryPolicy(createStudioTransientModelRetryPolicy());
    bootLog("step 3: installTransientModelRetryPolicy() completed");

    bootLog("step 4: initializeObservability() entering");
    observability = initializeObservability();
    bootLog("step 4: initializeObservability() completed");

    // Said out loud on every start, because the alternative was a number in a
    // file nobody reads. `.node-version` and `engines` were both unenforced —
    // no CI, no version manager — so the whole Stage 4 cycle was measured on a
    // runtime below the floor our dependencies declare, and nothing said so
    // (meta-task #79).
    bootLog("step 5: reportNodeRuntime() entering");
    reportNodeRuntime(observability.logger);
    bootLog("step 5: reportNodeRuntime() completed");

    bootLog("step 6: admission session entering");
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
    bootLog("step 6: admission session completed");

    // Durable: an unanswered question survives a restart and is asked again
    // rather than disappearing with the process (ADR 0036).
    bootLog("step 7: PermissionApprovalBroker and StudioRuntime entering");
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
    bootLog("step 7: PermissionApprovalBroker and StudioRuntime completed");

    // Same database, same construction style as `servers`: the provider
    // surface is composed here so the connection it reads from is the one this
    // root owns and closes. Keys go to the OS credential store, never the
    // database, which is ConnectionStore's own rule to enforce.
    bootLog("step 8: ConnectionStore, ProviderManagementService entering");
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
    bootLog("step 8: ConnectionStore, ProviderManagementService completed");

    // Reads and writes the same app_setting keys and keychain entries the
    // retrieval tool path uses; its own store instances over the same
    // database and OS keyring, the way every consumer here builds one.
    bootLog("step 9: RetrievalManagementService entering");
    const retrieval = new RetrievalManagementService({
      settings: new RetrievalSettingsStore(database),
      credentials: new KeyringCredentialStore(),
    });
    bootLog("step 9: RetrievalManagementService completed");

    // The conversation index and the project tables: the product's own record
    // of what exists, over the same database and behind the same admission
    // middleware as everything else. The transcript stays in Flue's journal;
    // nothing here reads or writes it.
    bootLog("step 10: conversation and project stores entering");
    const conversations = new ConversationStore(database);
    const projects = new ProjectStore(database);
    bootLog("step 10: conversation and project stores completed");

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

    bootLog("step 11: createHttpApp entering");
    const app = createHttpApp({
      servers: runtime.servers,
      providers,
      retrieval,
      approvals,
      conversations,
      projects,
      admission: admission.verifier,
      // The same list the model picker is filled from: a submission's model
      // reference is settled against it at admission, so a choice the catalog
      // no longer serves is refused with a reason instead of dying later
      // inside the run.
      isModelServed: async (modelId) =>
        (await providers.servedModelReferences()).has(modelId),
      // The same drain the signal handlers run, reached over HTTP because the
      // Host has no deliverable signal on Windows (see the route module). The
      // response goes out first: `requestShutdown` only starts the async drain,
      // and the exit at its end is always after the socket has flushed.
      requestShutdown: () => {
        void shutdown().finally(() => process.exit(0));
      },
    });
    bootLog("step 11: createHttpApp completed");

    return { app, shutdown };
  } catch (error) {
    // The stack, not just the sentence: this is the one path where a start
    // fails after having spoken, and the phase names above it are only half
    // the answer.
    bootLog(
      `composition root FAILED: ${error instanceof Error ? (error.stack ?? error.message) : String(error)}`,
    );
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
 * Windows, and the TypeScript launcher can send the parent-owned `shutdown`
 * message. The Rust Host uses none of those: it asks over
 * `POST /api/shutdown` with the admission bearer, which works identically on
 * both platforms and is the reason this process can always be stopped politely
 * by the one that owns it.
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
