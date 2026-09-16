// The admission bootstrap, evaluated before anything this file composes.
//
// This is an ordering constraint, not a style choice: the composition root
// reads `PROJECT_STUDIO_ADMISSION_CREDENTIAL` from the environment below,
// and in the built artifact this module's side effects run during the static
// import phase - the bundler hoists the app chunk's evaluation to the entry
// facade's import line, before `src/server.ts`'s own body runs. Importing
// the bootstrap HERE is what guarantees the frame is read (and the three
// `PROJECT_STUDIO_ADMISSION_*` variables published) before the admission
// session is created. `src/server.ts` imports the same module for the same
// reason; module evaluation makes the second import a no-op.
import "./host/bootstrap.js";

import { dispatch } from "@flue/runtime";

import {
  admissionCredentialFromEnvironment,
} from "./admission/verifier.js";
import { createAdmissionSession } from "./admission/verifier.js";
import { PermissionApprovalBroker } from "./application/approval-broker.js";
import { QuestionBroker } from "./application/question-broker.js";
import { PendingApprovalStore } from "./permissions/pending-approvals.js";
import { PendingQuestionStore } from "./questions/pending-questions.js";
import { PlanItemStore } from "./plan/plan-items.js";
import {
  configureStudioRuntime,
  StudioRuntime,
} from "./application/studio-runtime.js";
import { resolveProviderConfig } from "./gateway/language/provider-config.js";
import { bootstrapModelProviders } from "./gateway/language/bootstrap.js";
import { refreshBackgroundLadder } from "./gateway/language/background-model.js";
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
import { registerShutdownDrain, requestShutdown } from "./host/shutdown.js";
import { Studio } from "./agents/studio.js";
import { openDatabase, type StudioDatabase } from "./storage/database.js";
import { KeyringCredentialStore } from "./credentials/keyring-store.js";
import { ConnectionStore } from "./gateway/connections/connection-store.js";
import { ModelCatalog } from "./gateway/connections/model-catalog.js";
import { ProviderManagementService } from "./gateway/connections/management.js";
import { createProviderIcons } from "./gateway/catalog/icons/index.js";
import { CapabilityResolver } from "./gateway/connections/capability-defaults.js";
import { builtinMediaAdapters } from "./gateway/media/adapters/index.js";
import { MediaJobs } from "./gateway/media/jobs.js";
import { MediaService } from "./gateway/media/service.js";
import { conversationArtifactsDirectory, studioPath } from "./platform/paths.js";
import { FaviconStore } from "./web/favicons.js";
import { RetrievalManagementService } from "./application/retrieval-management.js";
import { RetrievalSettingsStore } from "./gateway/retrieval/settings.js";
import { ConversationStore } from "./conversations/store.js";
import { ConversationTitler } from "./conversations/titling.js";
import { TextImprover } from "./application/text-improver.js";
import { ContextUsageTracker } from "./conversations/context-usage.js";
import { ProjectStore } from "./projects/store.js";
import { WorkspaceTrustStore } from "./permissions/trust.js";
import { SandboxScopeStore } from "./sandbox/scope-store.js";

interface HarnessApplication {
  readonly app: ReturnType<typeof createHttpApp>;
  readonly shutdown: () => Promise<void>;
}

/**
 * Async, and awaited at the module's top level below: the titler's ladder
 * refresh (step 2b) is the one composition step that cannot be synchronous,
 * and it must finish before the app module's evaluation does - so no server
 * can listen, and no dispatch can arrive, while the snapshot is uncomputed.
 * The entry imports this module through the same static-import chain it
 * already awaits, so the ordering is structural rather than hoped for.
 */
async function createHarnessApplication(): Promise<HarnessApplication> {
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

    // The titler's model ladder is read synchronously at render time (a Flue
    // 2.0 agent function cannot await), so the model layer computes it here,
    // once, before the server can accept a dispatch - the only moment the
    // uncomputed state would ever be visible. A failed refresh is logged and
    // absorbed: titling is not on any turn's path, and an empty ladder
    // degrades to the documented alias fallback rather than to a dead
    // server. Said out loud, because a silent empty snapshot is exactly the
    // "titling quietly rode the frontier alias" shape the ladder exists to
    // refuse.
    bootLog("step 2b: refreshBackgroundLadder() entering");
    try {
      await refreshBackgroundLadder();
      bootLog("step 2b: refreshBackgroundLadder() completed");
    } catch (error) {
      bootLog(
        `step 2b: refreshBackgroundLadder() FAILED: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

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
    // rather than disappearing with the process (ADR 0036). Two channels, two
    // stores, on purpose: a permission question can never take a default or a
    // deadline, and a product question can - sharing rows would put the first
    // bug that confuses them one auto-approval away.
    bootLog("step 7: PermissionApprovalBroker and StudioRuntime entering");
    const approvals = new PermissionApprovalBroker({
      store: new PendingApprovalStore(database),
    });
    const questions = new QuestionBroker({
      store: new PendingQuestionStore(database),
    });
    // The plan is the third durable surface over the same database, and the
    // one that belongs to the conversation rather than to a run or a pending
    // decision: it neither parks nor expires, so a store - not a broker -
    // is all the channel it needs.
    const plans = new PlanItemStore(database);
    // Generations are jobs the conversation owns: their bytes land in its
    // artifacts directory, and nothing of ours keeps polling a vendor after
    // Studio has closed, so the registry is stopped with the runtime below.
    // Built before the runtime because the tools and the HTTP surface share it.
    const mediaJobs = new MediaJobs({ artifactsDirectory: conversationArtifactsDirectory });
    const mediaAdapters = builtinMediaAdapters();
    const runtime = new StudioRuntime({
      database,
      logger: observability.logger,
      approver: approvals,
      questions,
      plans,
      clientId: admission.context.clientId,
      sessionId: admission.context.sessionId,
      mediaJobs,
      mediaAdapters,
      // The finished-job ping's one Flue seam: when a background job ends, its
      // news is dispatched to the conversation's own agent instance as a
      // signal - a delivery, not a turn-settings-carrying prompt, so it needs
      // no admission of its own. Flue wakes an idle conversation with a new
      // response and hands a busy one the news at its next turn boundary, and
      // neither the model's answer nor the signal's delivery depends on the
      // user writing anything. The settings row it reads was settled by the
      // earlier, human turns; a signal changes none of them. Anything here
      // failing is logged by the hub and costs one piece of news - the
      // registries' own exactly-once means it will not be repeated either.
      deliverJobPing: (conversationId, body) =>
        dispatch(Studio, {
          id: conversationId,
          message: { kind: "signal", type: "studio.jobs.finished", body },
        }).then(() => undefined),
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
    // Held here rather than inline: the capability resolver (media, and the
    // generation tools when they land) reads the same catalog the provider
    // surface does - one store, one truth about which models exist.
    const modelCatalog = new ModelCatalog({
      db: database,
      connections: providerConnections,
    });
    const providers = new ProviderManagementService({
      connections: providerConnections,
      catalog: modelCatalog,
      // Real vendor icons, cached under the Studio home's disposable cache
      // directory. One catalog over every source -- see providers/icons -- so
      // the webview asks one question and never learns which vendors live
      // where. Every lookup misses gracefully offline.
      icons: createProviderIcons({
        cacheDir: studioPath("cache", "provider-icons"),
      }),
    });
    bootLog("step 8: ConnectionStore, ProviderManagementService completed");

    // Dictation and read-aloud resolve their slot through the same capability
    // seam every consumer shares; the drivers they dispatch to live in
    // src/media/drivers, one file per protocol.
    bootLog("step 8b: MediaService entering");
    const media = new MediaService({
      resolver: new CapabilityResolver({
        connections: providerConnections,
        catalog: modelCatalog,
        credentials: new KeyringCredentialStore(),
      }),
      jobs: mediaJobs,
      adapters: mediaAdapters,
    });
    bootLog("step 8b: MediaService completed");

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
    // The doors the person opened in the wall: one table, one owner, read
    // where the policy is built and written from the settings pane and from
    // a scope question's answer.
    const scopes = new SandboxScopeStore(database);
    // The answer to "do you vouch for this folder", which the permission
    // kernel reads as a precondition ahead of every policy rule and every
    // grant. The runtime holds a store of its own over the same table for the
    // reading side; this one exists so the app can also *write* it, which
    // until now nothing could - and an unwritten table means every project
    // folder is undecided, so every project conversation could only read.
    const trust = new WorkspaceTrustStore(database);
    // The automatic titling pass: watches the runtime for a conversation's
    // first exchange settling and writes the title agent's answer into the
    // index, once, while the row is still unnamed by a person. Subscribes
    // here because the event bus is process-global and the composition root
    // is the one place lifecycle is owned; unsubscribed in the drain below.
    const titling = new ConversationTitler({
      conversations,
      logger: observability.logger,
    });
    titling.start();
    // The dictation improver: one request, one reply, on the same bus. It
    // subscribes on its first request and is stopped in the drain below.
    const improver = new TextImprover();
    // The measured context, from the same process-global bus and for the same
    // reason it is subscribed here rather than deeper: a run's own usage is
    // reported to the observer, not to the transcript, and the webview cannot
    // see it any other way. Stopped in the drain below beside the titler.
    const contextUsage = new ContextUsageTracker({ database });
    contextUsage.start();
    bootLog("step 10: conversation and project stores completed");

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = (): Promise<void> => {
      shutdownPromise ??= (async () => {
        admission?.verifier.invalidate();
        try {
          titling.stop();
          improver.stop();
          contextUsage.stop();
          // Nothing of ours keeps polling a vendor once Studio has closed;
          // a job with a cancel endpoint is told.
          mediaJobs.stopAll();
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
      skills: runtime.skills,
      // Awaited before the run renders. `start()` memoises, so this costs one
      // wait on the first submission after a harness starts and nothing at
      // all afterwards - and it is what lets a capability Studio ships be
      // described truthfully on a conversation's very first turn instead of
      // announced as "still being read" and corrected on its second.
      reopenCapabilityNote: async (conversationId) => {
        await runtime.start();
        runtime.reopenCapabilityInventory(conversationId);
      },
      providers,
      retrieval,
      media,
      improver,
      // Site icons, fetched by the harness once per host and kept in the
      // cache directory; the window asks here and never the site.
      favicons: new FaviconStore({ directory: studioPath("cache", "favicons") }),
      approvals,
      questions,
      plans,
      conversations,
      projects,
      scopes,
      trust,
      database,
      titling,
      contextUsage,
      backgroundJobs: runtime.backgroundJobs,
      browser: { stop: (conversationId) => runtime.stopBrowser(conversationId) },
      computer: { stop: (conversationId) => runtime.stopComputer(conversationId) },
      admission: admission.verifier,
      // The same list the model picker is filled from: a submission's model
      // reference is settled against it at admission, so a choice the catalog
      // no longer serves is refused with a reason instead of dying later
      // inside the run.
      isModelServed: async (modelId) =>
        (await providers.servedModelReferences()).has(modelId),
      // The studio agent, mounted under /agents/studio by createHttpApp.
      // Its render reads the turn-settings row this admission settled.
      agent: Studio,
      // The unified stop (see src/host/shutdown.ts): the response goes out
      // first, then the runtime and the composition drain run, then the
      // process exits - always after the socket has flushed.
      requestShutdown: () => requestShutdown(0),
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

const { app, shutdown } = await createHarnessApplication();

/**
 * The composition half of the unified stop (see `src/host/shutdown.ts`).
 *
 * The server entry (`src/server.ts`) owns the listen, the signals and the
 * Flue application's own stop, and registers both halves into one
 * `requestShutdown`; every exit path - the Host's authenticated
 * `POST /api/shutdown`, SIGINT/SIGTERM, the launcher's IPC message, the
 * parent's disconnect - runs the same sequence. This registration closes the
 * half the composition owns.
 */
registerShutdownDrain(shutdown);

/**
 * The TypeScript launcher's stop channel.
 *
 * `SIGTERM` is not deliverable on Windows - `process.kill` there maps to
 * `TerminateProcess`, which ends the process without running a handler. The
 * launcher (and the test harnesses) therefore ask over the Node IPC channel,
 * which reaches a handler on every platform. The Rust Host uses none of
 * those: it asks over `POST /api/shutdown` with the admission bearer, which
 * works identically on both platforms and is the reason this process can
 * always be stopped politely by the one that owns it.
 */
process.on("message", (message) => {
  if (message === "shutdown") requestShutdown(0);
});

export default app;
