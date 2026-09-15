import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import type { SkillAdministration, SkillReadContext } from "../../../application/skill-management.js";
import { ExtendError } from "../../../extend/errors.js";
import { GLOBAL_SCOPE, conversationScope, projectScope } from "../../../extend/selection.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import { authContext, requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

/**
 * `/api/skills`: what is installed, what looked installed and was not, and
 * the decision at each scope about whether one is on.
 *
 * Deliberately the MCP routes with everything but the decision removed. A
 * skill is installed by putting a folder in place and uninstalled by taking
 * it out, so there is no POST, no PATCH, no DELETE, and nothing that holds a
 * secret. What is left is the one question the two kinds share, spelled the
 * same way at the same three scopes, so the settings control that renders
 * one can render the other without learning the difference.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function body(context: { req: { json(): Promise<unknown> } }): Promise<unknown> {
  try {
    return await context.req.json();
  } catch {
    throw new ExtendError("internal", { message: "The request body must be valid JSON." });
  }
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

/** The same reading of the query string the MCP list makes, for the same reason. */
function readContext(context: { req: { query(name: string): string | undefined } }): SkillReadContext {
  const projectId = context.req.query("projectId");
  const conversationId = context.req.query("conversationId");
  return {
    ...(projectId === undefined || projectId === "" ? {} : { projectId }),
    ...(conversationId === undefined || conversationId === "" ? {} : { conversationId }),
  };
}

/**
 * The decision body, for every scope. `null` is not a spelling of `false`:
 * it clears the decision at this scope so the wider one applies again.
 */
function decision(value: unknown): boolean | null {
  if (!isRecord(value)) {
    throw new ExtendError("internal", { message: "The body must be an object." });
  }
  const enabled = value["enabled"];
  if (enabled === null || typeof enabled === "boolean") return enabled;
  throw new ExtendError("internal", {
    message: "enabled must be true, false, or null to inherit.",
  });
}

export function createSkillRoutes(skills: SkillAdministration): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.EXTENSION_MANAGEMENT));

  routes.get("/", (context) => {
    // The list first, so the problems are the ones that scan found.
    const list = skills.list(readContext(context));
    return context.json({ skills: list, problems: skills.problems() });
  });

  // The user's default. The only route that can write the global scope, for
  // the reason the MCP routes give: a global change made from inside one
  // project is a change someone did not know they were making.
  routes.put("/extensions/skill/:id", async (context) => {
    try {
      const enabled = decision(await body(context));
      skills.setEnabled(GLOBAL_SCOPE, context.req.param("id"), enabled, authContext(context));
      return context.json({ enabled });
    } catch (error) {
      return context.json(failure(error), statusFor(error));
    }
  });

  routes.put(
    "/projects/:projectId/extensions/skill/:id",
    requireAdmissionScope(ADMISSION_SCOPES.PROJECT),
    async (context) => {
      try {
        const enabled = decision(await body(context));
        skills.setEnabled(
          projectScope(context.req.param("projectId")),
          context.req.param("id"),
          enabled,
          authContext(context),
        );
        return context.json({ enabled });
      } catch (error) {
        return context.json(failure(error), statusFor(error));
      }
    },
  );

  routes.put(
    "/conversations/:conversationId/extensions/skill/:id",
    requireAdmissionScope(ADMISSION_SCOPES.PROJECT),
    async (context) => {
      try {
        const enabled = decision(await body(context));
        skills.setEnabled(
          conversationScope(context.req.param("conversationId")),
          context.req.param("id"),
          enabled,
          authContext(context),
        );
        return context.json({ enabled });
      } catch (error) {
        return context.json(failure(error), statusFor(error));
      }
    },
  );

  return routes;
}

/** A skill that is not there is a 404; anything else about the request is a 400. */
function statusFor(error: unknown): 400 | 404 {
  return error instanceof ExtendError && error.kind === "not_installed" ? 404 : 400;
}
