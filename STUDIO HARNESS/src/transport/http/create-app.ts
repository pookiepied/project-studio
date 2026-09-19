import { createAgentRouter } from "@flue/runtime/routing";
import type { Agent } from "@flue/runtime";
import { Hono } from "hono";

import type { AdmissionVerifier } from "../../admission/verifier.js";
import { ADMISSION_SCOPES } from "../../admission/scopes.js";
import type { PermissionApprovalBroker } from "../../application/approval-broker.js";
import type { QuestionBroker } from "../../application/question-broker.js";
import type { McpAdministration } from "../../application/mcp-management.js";
import type { SkillAdministration } from "../../application/skill-management.js";
import { createSkillRoutes } from "./routes/skills.js";
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
import { createLifecycleRoutes } from "./routes/lifecycle.js";
import { createMediaRoutes } from "./routes/media.js";
import type { TextImproverPort } from "../../application/text-improver.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createApprovalRoutes } from "./routes/permissions.js";
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
  /**
   * Site icons for the transcript's search results and page reads. Optional
   * the way `improver` is: a composition without it answers no icon routes
   * and the window draws every site as its letter.
   */
  readonly favicons?: FaviconSource;
  readonly approvals: PermissionApprovalBroker;
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
  /**
   * The measured context usage per conversation, when something is watching
   * the runtime for it. `createConversationRoutes` reads it through
   * `options`, so this only has to reach the shape it declares.
   */
  readonly contextUsage?: ContextUsageTracker;
  /**
   * The runtime's background commands, for the panel that lists them.
   * `createConversationRoutes` reads it through `options`, so this only has to
   * reach the shape it declares.
   */
  readonly backgroundJobs?: BackgroundJobs;
  /** The person's stop for a conversation's browser (ADR 0049 §4). */
  readonly browser?: { stop(conversationId: string): Promise<boolean> };
  /** The person's stop for a conversation's computer control (ADR 0055 §7). */
  readonly computer?: { stop(conversationId: string): Promise<boolean> };
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

  app.route("/api/mcp", createMcpRoutes(options.servers));
  app.route("/api/skills", createSkillRoutes(options.skills));
  app.route("/api/providers", createProviderRoutes(options.providers));
  app.route("/api/providers/retrieval", createRetrievalRoutes(options.retrieval));
  app.route(
    "/api/media",
    createMediaRoutes(options.media, options.improver === undefined ? {} : { improver: options.improver }),
  );
  app.route("/api/permissions", createApprovalRoutes(options.approvals));
  if (options.favicons !== undefined) {
    app.route("/api/web", createWebRoutes(options.favicons));
  }
  if (options.questions !== undefined) {
    app.route("/api/questions", createQuestionRoutes(options.questions));
  }
  if (options.plans !== undefined) {
    app.route("/api/plans", createPlanRoutes(options.plans));
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
