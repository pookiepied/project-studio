import { createAgentRouter } from "@flue/runtime/routing";
import type { Agent } from "@flue/runtime";
import { Hono } from "hono";

import type { AdmissionVerifier } from "../../admission/verifier.js";
import { ADMISSION_SCOPES } from "../../admission/scopes.js";
import type { PermissionApprovalBroker } from "../../application/approval-broker.js";
import type { PermissionGrantsView } from "../../permissions/grant-store.js";
import type { QuestionBroker } from "../../application/question-broker.js";
import type { McpAdministration } from "../../application/mcp-management.js";
import type { SkillAdministration } from "../../application/skill-management.js";
import { createSkillRoutes } from "./routes/skills.js";
import { createCommandRoutes } from "./routes/commands.js";
import { createLibraryRoutes } from "./routes/library.js";
import type { LibraryStore } from "../../library/store.js";
import type { ImageDescriberPort } from "../../library/describer.js";
import type { CommandRegistry } from "../../extend/commands/registry.js";
import type { ProviderAdministration } from "../../gateway/connections/management.js";
import type { RetrievalAdministration } from "../../application/retrieval-management.js";
import type { MediaAdministration } from "../../gateway/media/service.js";
import type { ConversationStore } from "../../conversations/store.js";
import type { ProjectStore } from "../../projects/store.js";
import type { PlanItemStore } from "../../plan/plan-items.js";
import type { StudioDatabase } from "../../storage/database.js";
import { createAdmissionMiddleware, requireAdmissionScope, type AdmissionEnv } from "./middleware/admission.js";
import { createTurnSettingsMiddleware } from "./middleware/turn-settings.js";
import type { ConversationTitlingPort } from "../../conversations/titling.js";
import type { BackgroundJobs } from "../../process/background.js";
import type { ContextUsageTracker } from "../../conversations/context-usage.js";
import { createConversationRoutes } from "./routes/conversations.js";
import type { DrawnShapeInput } from "../../contracts/voice-computer.js";
import type { TaskStore } from "../../agents/definitions/task-store.js";
import type { TaskControlPort } from "./routes/tasks.js";
import { createTaskRoutes } from "./routes/tasks.js";
import type { RegisteredAgent } from "../../agents/definitions/registry.js";
import { createAgentRoutes } from "./routes/agents.js";
import type { CompactionReadiness } from "../../conversations/compaction.js";
import type { ConversationSnapshots } from "../../snapshots/store.js";
import { createLifecycleRoutes } from "./routes/lifecycle.js";
import { createDiagnosticRoutes } from "./routes/diagnostics.js";
import { createObservationRoutes } from "./routes/observations.js";
import { createMediaRoutes } from "./routes/media.js";
import type { TextImproverPort } from "../../application/text-improver.js";
import type { VoiceSettings } from "../../gateway/language/voice-settings.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createApprovalRoutes } from "./routes/permissions.js";
import { createGrantsRoutes } from "./routes/grants.js";
import { createQuestionRoutes } from "./routes/questions.js";
import { createPlanRoutes } from "./routes/plans.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createProviderRoutes } from "./routes/providers.js";
import { createRetrievalRoutes } from "./routes/retrieval.js";
import { createSandboxRoutes } from "./routes/sandbox.js";
import { createWebRoutes } from "./routes/web.js";
import { streamHeartbeat } from "./sse-heartbeat.js";
import type { FaviconSource } from "../../web/favicons.js";

export interface CreateHttpAppOptions {
  /** The MCP administration surface — a port, not the runtime (ADR 0035 §2). */
  readonly servers: McpAdministration;
  /** The skill administration surface, the same kind of port as `servers`. */
  readonly skills: SkillAdministration;
  /**
   * The slash commands, when composed. Optional for tests; production wires
   * it, because a composition without it has a slash that knows nothing.
   */
  readonly commands?: CommandRegistry;
  /**
   * The library - the files the person keeps beyond one conversation - and
   * the describer that proposes a picture's label. Optional for tests; a
   * composition without them has no library page.
   */
  readonly library?: LibraryStore;
  readonly describer?: ImageDescriberPort;
  /**
   * Re-asks a conversation's capability note, called by the turn-settings
   * middleware between submissions. A port of the same shape as `servers`:
   * the runtime implements it and this layer must not learn why. Optional
   * for tests; production always wires it, because a composition without
   * it leaves a pending note pending for the conversation's whole life -
   * the bug the settled-ness exception exists to prevent.
   */
  readonly reopenCapabilityNote?: (conversationId: string) => void | Promise<void>;
  /** The provider administration surface — a port of the same shape. */
  readonly providers: ProviderAdministration;
  /**
   * The retrieval settings surface — a sibling of `providers` over the same
   * tree and scope, kept separate because its storage and vocabulary are.
   */
  readonly retrieval: RetrievalAdministration;
  /**
   * The media surface - dictation and read-aloud. The person is the invoker,
   * so it mounts beside the conversation routes rather than the tools.
   */
  readonly media: MediaAdministration;
  /** Tidies a dictated passage on the default model; optional for tests. */
  readonly improver?: TextImproverPort;
  readonly voiceSettings?: VoiceSettings;
  /**
   * Site icons for the transcript's search results and page reads. Optional
   * the way `improver` is: a composition without it answers no icon routes
   * and the window draws every site as its letter.
   */
  readonly favicons?: FaviconSource;
  readonly approvals: PermissionApprovalBroker;
  /**
   * The stored grants, as the narrow view a route may hold. Required the way
   * `approvals` is: an approval the user cannot see or take back is worse
   * than never having asked, so a composition without this is not a smaller
   * product but a broken one — it should fail to compose rather than serve
   * permissions nobody can withdraw.
   */
  readonly grants: PermissionGrantsView;
  /**
   * The ask-a-question channel, beside - never inside - the approval one. The
   * two surfaces answer the same kind of silence from the person and are kept
   * apart so neither grows the other's semantics. Optional the way `titling`
   * is: absent means no question routes exist, which a composition that offers
   * no ask tool also wants, and production must not be.
   */
  readonly questions?: QuestionBroker;
  /**
   * The plan store, for the routes the panel and the pill read and tick
   * through. Optional the way `questions` is: absent means no plan routes
   * exist, which a composition that offers no plan tool also wants, and
   * production must not be.
   */
  readonly plans?: PlanItemStore;
  /** The conversation index: rows, never transcript content. */
  readonly conversations: ConversationStore;
  readonly queuedMessages?: (conversationId: string, submissionId: string | null, action: "list" | "steer" | "remove" | "edit") => Promise<unknown>;
  /**
   * The measured context usage per conversation, when something is watching
   * the runtime for it. `createConversationRoutes` reads it through
   * `options`, so this only has to reach the shape it declares.
   */
  readonly contextUsage?: ContextUsageTracker;
  /**
   * Manual compaction and its readiness, when a runtime was composed.
   * `createConversationRoutes` reads it through `options`.
   */
  readonly compaction?: {
    readiness(conversationId: string): CompactionReadiness;
    compact(conversationId: string): Promise<void>;
  };
  /**
   * The undo surface — a conversation's snapshot history and its restore —
   * read by `createConversationRoutes` through `options`, the same way
   * `compaction` is. The store behind it is the runtime's own, so a restore
   * joins the same queue the gate's captures run on rather than racing them.
   */
  readonly snapshots?: ConversationSnapshots;
  /**
   * The runtime's background commands, for the panel that lists them.
   * `createConversationRoutes` reads it through `options`, so this only has to
   * reach the shape it declares.
   */
  readonly backgroundJobs?: BackgroundJobs;
  /**
   * The background agent tasks' index and its cancel port, when a runtime
   * was composed. Optional the way `backgroundJobs` is: absent means no task
   * routes exist, and production must not be that composition — the rows the
   * dispatcher records would otherwise be visible to nothing.
   */
  readonly tasks?: TaskStore;
  readonly taskControl?: TaskControlPort;
  /**
   * The agent registry, for the read-only roster route (S5.3). Optional the
   * way `tasks` is: absent means no roster route exists, and production must
   * not be that composition — the Settings pane would name agents nobody
   * can verify.
   */
  readonly agents?: { list(): readonly RegisteredAgent[] };
  /** The person's stop for a conversation's browser (ADR 0049 §4). */
  readonly browser?: {
    stop(conversationId: string): Promise<boolean>;
    interact?(conversationId: string, input: import("../../browser/interaction.js").BrowserInteraction): Promise<unknown>;
  };
  /** The person's stop for a conversation's computer control (ADR 0055 §7). */
  readonly computer?: {
    stop(conversationId: string): Promise<boolean>;
    control?(conversationId: string, action: "state" | "pause" | "resume" | "demonstrate"): Promise<unknown>;
    sharing?(conversationId: string, on: boolean): Promise<{ readonly sharing: boolean }>;
    glance?(conversationId: string): Promise<unknown>;
    drew?(conversationId: string, shapes: readonly DrawnShapeInput[]): Promise<unknown>;
  };
  /**
   * The application database. The conversation routes own the purge of
   * conversation-scoped rows through it; everything else keeps reaching only
   * its own store.
   */
  readonly database: StudioDatabase;
  /**
   * The automatic titling port, when a titler was composed. The turn-settings
   * middleware hands it every first admission's message; absent means no
   * titling happens, which tests rely on and production must not.
   */
  readonly titling?: ConversationTitlingPort;
  /** Projects and their folders over the same database. */
  readonly projects: ProjectStore;
  /**
   * The sandbox scope store, over the same database. Optional the way `plans`
   * is: absent means no sandbox routes exist, which a composition without the
   * scope table also wants, and production must not be.
   */
  readonly scopes?: import("../../sandbox/scope-store.js").SandboxScopeStore;
  /**
   * The folder decisions, over the same database. Wired beside `scopes`
   * because the sandbox routes serve both, and optional for the same reason:
   * a composition without it answers no trust question, and production must
   * not be that composition - without it every project folder stays
   * undecided, which means read-only forever with nothing able to say
   * otherwise.
   */
  readonly trust?: import("../../permissions/trust.js").WorkspaceTrustStore;
  /**
   * Where the sandbox folder browser opens when no path is named. The
   * person's home in production; a test's temporary directory here, the same
   * optional-for-tests shape as `titling` and `questions`.
   */
  readonly browseHome?: string;
  /** The shell preference store (ADR 0057), served under the sandbox routes. */
  readonly shell?: import("../../process/shell-settings.js").ShellSettingsStore;
  /** The sandbox fence switch (ADR 0057), served beside it. */
  readonly isolation?: import("../../sandbox/isolation-settings.js").IsolationSettingsStore;
  readonly admission: AdmissionVerifier;
  /**
   * Answers whether the catalog currently serves a model reference. Settling a
   * submission's turn settings against the list its picker was filled from is
   * the admission path's one outward fact; the wiring lives at composition.
   */
  readonly isModelServed: (modelId: string) => Promise<boolean>;
  /**
   * Begins this process's graceful shutdown when the Studio Host asks over
   * `POST /api/shutdown`. Required rather than optional so a composition
   * cannot wire the route while forgetting that it has to end the process.
   */
  readonly requestShutdown: () => void;
  /**
   * The agent mounted under `/agents/studio`. Production passes the studio
   * agent module's own export; tests inject a stand-in function so the
   * router shape and the middleware ordering can be exercised without the
   * real agent's render. Flue 2.0 mounts one router per agent - there is no
   * catch-all `flue()` app any more - which is why the mount is explicit.
   */
  readonly agent: Agent;
}

/**
 * Composes every Harness HTTP surface behind one admission middleware. This is
 * deliberately a factory so tests and a future Studio Host can own lifecycle
 * without moving authentication into a route module.
 */
export function createHttpApp(options: CreateHttpAppOptions): Hono<AdmissionEnv> {
  const app = new Hono<AdmissionEnv>();
  app.use("*", createAdmissionMiddleware(options.admission));
  app.use("/api/diagnostics/*", requireAdmissionScope(ADMISSION_SCOPES.DIAGNOSTIC));
  app.route("/api/diagnostics", createDiagnosticRoutes());
  app.use("/api/observations/*", requireAdmissionScope(ADMISSION_SCOPES.AGENT_RUN));
  app.use("/api/observations/native", requireAdmissionScope(ADMISSION_SCOPES.DIAGNOSTIC));
  app.route("/api/observations", createObservationRoutes());

  app.route("/api/mcp", createMcpRoutes(options.servers));
  app.route("/api/skills", createSkillRoutes(options.skills));
  if (options.commands !== undefined) {
    app.route("/api/commands", createCommandRoutes(options.commands));
  }
  if (options.library !== undefined) {
    app.route(
      "/api/library",
      createLibraryRoutes(options.library, options.describer === undefined ? {} : { describer: options.describer }),
    );
  }
  app.route("/api/providers", createProviderRoutes(options.providers));
  app.route("/api/providers/retrieval", createRetrievalRoutes(options.retrieval));
  app.route(
    "/api/media",
    createMediaRoutes(options.media, {
      ...(options.improver === undefined ? {} : { improver: options.improver }),
      ...(options.voiceSettings === undefined ? {} : { voiceSettings: options.voiceSettings }),
      isModelServed: options.isModelServed,
    }),
  );
  app.route("/api/permissions", createApprovalRoutes(options.approvals));
  app.route("/api/permissions/grants", createGrantsRoutes(options.grants));
  if (options.favicons !== undefined) {
    app.route("/api/web", createWebRoutes(options.favicons));
  }
  if (options.questions !== undefined) {
    app.route("/api/questions", createQuestionRoutes(options.questions));
  }
  if (options.plans !== undefined) {
    app.route("/api/plans", createPlanRoutes(options.plans));
  }
  if (options.tasks !== undefined && options.taskControl !== undefined) {
    app.route("/api/tasks", createTaskRoutes(options.tasks, options.taskControl));
  }
  if (options.agents !== undefined) {
    app.route("/api/agents", createAgentRoutes(options.agents));
  }
  app.route("/api/conversations", createConversationRoutes(options));
  app.route("/api/projects", createProjectRoutes(options));
  if (options.scopes !== undefined) {
    app.route(
      "/api/sandbox",
      createSandboxRoutes({
        scopes: options.scopes,
        projects: options.projects,
        ...(options.trust === undefined ? {} : { trust: options.trust }),
        ...(options.browseHome === undefined ? {} : { browseHome: options.browseHome }),
        ...(options.shell === undefined ? {} : { shell: options.shell }),
        ...(options.isolation === undefined ? {} : { isolation: options.isolation }),
      }),
    );
  }
  app.route("/api", createLifecycleRoutes({ requestShutdown: options.requestShutdown }));

  const agentRoutes = new Hono<AdmissionEnv>();
  agentRoutes.use("*", requireAdmissionScope(ADMISSION_SCOPES.AGENT_RUN));
  // Before the agent router: a submission's model and reasoning level are
  // settled into the conversation index on the way in, so the run's render
  // reads a row that already holds what this turn was sent with. See the
  // middleware.
  agentRoutes.use(
    "*",
    createTurnSettingsMiddleware({
      conversations: options.conversations,
      isModelServed: options.isModelServed,
      ...(options.voiceSettings === undefined ? {} : { voiceModel: () => options.voiceSettings?.get() ?? null }),
      ...(options.titling === undefined ? {} : { titling: options.titling }),
      ...(options.reopenCapabilityNote === undefined
        ? {}
        : { reopenCapabilityNote: options.reopenCapabilityNote }),
    }),
  );
  // After the turn settings, before the agent router, so it answers for
  // everything the mounted routes hold open. Both of this harness's readers
  // give a run's stream 45 seconds between bytes and call it broken past
  // that, on the documented belief that the harness heartbeats its stream;
  // this is that habit, finally kept. Measured where it went wrong: a
  // reasoning model thinking 86s before its first token, and an 88s shell
  // tool, each breaking the read in the middle of working.
  agentRoutes.use("*", streamHeartbeat());
  // The URL shape is ours and must not move: the webview, the Tauri IPC seam
  // and the tests all address `/agents/studio/<conversation id>`. Flue 2.0's
  // agent routers serve `/:id` relative to their mount, so the studio agent's
  // router mounts under the same prefix the 1.0 auto-router used to expose.
  agentRoutes.route("/agents/studio", createAgentRouter(options.agent));
  app.route("/", agentRoutes);

  return app;
}
