import { flue } from "@flue/runtime/routing";
import { Hono } from "hono";

import type { AdmissionVerifier } from "../../admission/verifier.js";
import { ADMISSION_SCOPES } from "../../admission/scopes.js";
import type { PermissionApprovalBroker } from "../../application/approval-broker.js";
import type { McpAdministration } from "../../application/mcp-management.js";
import { createAdmissionMiddleware, requireAdmissionScope, type AdmissionEnv } from "./middleware/admission.js";
import { createMcpRoutes } from "./routes/mcp.js";
import { createApprovalRoutes } from "./routes/permissions.js";

export interface CreateHttpAppOptions {
  /** The MCP administration surface — a port, not the runtime (ADR 0035 §2). */
  readonly servers: McpAdministration;
  readonly approvals: PermissionApprovalBroker;
  readonly admission: AdmissionVerifier;
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
  app.route("/api/permissions", createApprovalRoutes(options.approvals));

  const agentRoutes = new Hono<AdmissionEnv>();
  agentRoutes.use("*", requireAdmissionScope(ADMISSION_SCOPES.AGENT_RUN));
  agentRoutes.route("/", options.flueApp ?? flue());
  app.route("/", agentRoutes);

  return app;
}
