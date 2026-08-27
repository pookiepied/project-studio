import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

import type { AdmissionVerifier } from "../../admission/verifier.js";
import { ADMISSION_SCOPES } from "../../admission/scopes.js";
import type { PermissionApprovalBroker } from "../../application/approval-broker.js";
import type { McpAdministration } from "../../application/mcp-management.js";
import type { ProviderAdministration } from "../../application/provider-management.js";
import type { RetrievalAdministration } from "../../application/retrieval-management.js";
import type { ConversationStore } from "../../conversations/store.js";
import type { ProjectStore } from "../../projects/store.js";
import { createAdmissionMiddleware, requireAdmissionScope, type AdmissionEnv } from "./middleware/admission.js";
import { createConversationRoutes } from "./routes/conversations.js";
import { createLifecycleRoutes } from "./routes/lifecycle.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createApprovalRoutes } from "./routes/permissions.js";
import { createProjectRoutes } from "./routes/projects.js";
import { createProviderRoutes } from "./routes/providers.js";
import { createRetrievalRoutes } from "./routes/retrieval.js";

export interface CreateHttpAppOptions {
  /** The MCP administration surface — a port, not the runtime (ADR 0035 §2). */
  readonly servers: McpAdministration;
  /** The provider administration surface — a port of the same shape. */
  readonly providers: ProviderAdministration;
  /**
   * The retrieval settings surface — a sibling of `providers` over the same
   * tree and scope, kept separate because its storage and vocabulary are.
   */
  readonly retrieval: RetrievalAdministration;
  readonly approvals: PermissionApprovalBroker;
  /** The conversation index: rows, never transcript content. */
  readonly conversations: ConversationStore;
  /** Projects and their folders over the same database. */
  readonly projects: ProjectStore;
  readonly admission: AdmissionVerifier;
  /**
   * Begins this process's graceful shutdown when the Studio Host asks over
   * `POST /api/shutdown`. Required rather than optional so a composition
   * cannot wire the route while forgetting that it has to end the process.
   */
  readonly requestShutdown: () => void;
  /** Injectable Flue app for tests; production uses the generated Flue app. */
  readonly flueApp?: Hono;
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
  app.route("/api/providers", createProviderRoutes(options.providers));
  app.route("/api/providers/retrieval", createRetrievalRoutes(options.retrieval));
  app.route("/api/permissions", createApprovalRoutes(options.approvals));
  app.route("/api/conversations", createConversationRoutes(options));
  app.route("/api/projects", createProjectRoutes(options));
  app.route("/api", createLifecycleRoutes({ requestShutdown: options.requestShutdown }));

  const agentRoutes = new Hono<AdmissionEnv>();
  agentRoutes.use("*", requireAdmissionScope(ADMISSION_SCOPES.AGENT_RUN));
  agentRoutes.route("/", options.flueApp ?? flue());
  app.route("/", agentRoutes);

  return app;
}
