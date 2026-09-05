import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { ExtendError } from "../../../extend/errors.js";
import type { PlanStatus } from "../../../plan/plan.js";
import type { PlanItemStore } from "../../../plan/plan-items.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";

/**
 * The plan routes, under their own prefix.
 *
 * The plan is product state - the conversation's standing intention - not a
 * question that blocks a run, so the admission scope is `project` beside the
 * conversation index rather than `approval` beside the questions: reading and
 * ticking a plan does not speak for the person the way answering a question
 * or approving a permission does.
 */
export function createPlanRoutes(store: PlanItemStore): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.PROJECT));

  routes.get("/:conversationId", (context) =>
    context.json(store.list(context.req.param("conversationId"))),
  );

  // The person's tick. The body names one of the two statuses a person is
  // given - `done` to tick, `pending` to untick - and nothing else: `failed`
  // is a claim about what happened, not a thing to toggle, and the model's
  // full vocabulary stays the model's.
  routes.post("/:conversationId/items/:itemId", async (context) => {
    try {
      const value = await context.req.json();
      const status = personStatus(value);
      const changed = store.update(
        context.req.param("conversationId"),
        context.req.param("itemId"),
        status,
        "person",
      );
      return changed ? context.body(null, 204) : context.json({ error: MISSING_ITEM }, 404);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  // Clears the conversation's plan: the remedy the panel offers when the rows
  // cannot be read, and the way a person removes a plan that no longer says
  // anything. Deleting is idempotent, so an already-empty plan answers 204.
  routes.delete("/:conversationId", (context) => {
    store.clearConversation(context.req.param("conversationId"));
    return context.body(null, 204);
  });

  return routes;
}

const MISSING_ITEM = "That item is not in this conversation's plan.";

/** The person's two statuses, and only those. */
function personStatus(value: unknown): PlanStatus {
  const status = isRecord(value) ? value["status"] : undefined;
  if (status === "done") return "done";
  if (status === "pending") return "pending";
  throw new ExtendError("internal", {
    message: "A tick sets an item to done, and unticking sets it back to pending.",
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}
