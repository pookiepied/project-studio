import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { authContext, requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import { ExtendError } from "../../../extend/errors.js";
import type { PermissionAnswer } from "../../../permissions/kernel.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import type { PermissionApprovalBroker } from "../../../application/approval-broker.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function answer(value: unknown): PermissionAnswer {
  if (!isRecord(value)) {
    throw new ExtendError("internal", { message: "The approval answer must be an object." });
  }
  const verdict = value["verdict"];
  const duration = value["duration"];
  if (
    (verdict !== "allow" && verdict !== "deny") ||
    (duration !== "once" && duration !== "conversation" && duration !== "always")
  ) {
    throw new ExtendError("internal", {
      message: "An approval answer needs a valid verdict and duration.",
    });
  }
  const scopeId = value["scopeId"];
  if (scopeId !== undefined && typeof scopeId !== "string") {
    throw new ExtendError("internal", { message: "scopeId must be text." });
  }
  return {
    verdict,
    duration,
    ...(scopeId === undefined ? {} : { scopeId }),
  };
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}

export function createApprovalRoutes(
  broker: PermissionApprovalBroker,
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.APPROVAL));

  routes.get("/pending", (context) =>
    context.json(broker.list(authContext(context))),
  );
  routes.post("/pending/:id", async (context) => {
    try {
      const value: unknown = await context.req.json();
      const accepted = broker.answer(
        context.req.param("id"),
        answer(value),
        authContext(context),
      );
      return accepted
        ? context.body(null, 204)
        : context.json({ error: "That approval is no longer pending." }, 404);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/pending/:id", (context) =>
    broker.cancel(context.req.param("id"), authContext(context))
      ? context.body(null, 204)
      : context.json({ error: "That approval is no longer pending." }, 404),
  );

  return routes;
}
