import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import { authContext, requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import { ExtendError } from "../../../extend/errors.js";
import { toErrorReport } from "../../../observability/error-reporter.js";
import type { QuestionBroker, QuestionReply } from "../../../application/question-broker.js";

/**
 * The ask-a-question routes, under their own prefix and beside - never inside
 * - the approval routes. The two channels look similar on screen and are not
 * the same rows: a permission question cannot be answered by a timeout, and
 * sharing one prefix would invite one API to grow the other's semantics.
 *
 * The admission scope is the approval scope, deliberately: what is being
 * guarded is "speaks for the person", which is the same authority answering a
 * question spends, whatever the question is about.
 */
export function createQuestionRoutes(broker: QuestionBroker): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.APPROVAL));

  routes.get("/pending", (context) => context.json(broker.list(authContext(context))));

  routes.post("/pending/:id", async (context) => {
    try {
      const value = await context.req.json();
      const accepted = broker.answer(
        context.req.param("id"),
        reply(value),
        authContext(context),
      );
      return accepted
        ? context.body(null, 204)
        : context.json({ error: "That question is no longer pending." }, 404);
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  routes.delete("/pending/:id", (context) =>
    broker.cancel(context.req.param("id"), authContext(context))
      ? context.body(null, 204)
      : context.json({ error: "That question is no longer pending." }, 404),
  );

  routes.post("/stop", async (context) => {
    try {
      const value = await context.req.json();
      const conversationId = value["conversationId"];
      if (typeof conversationId !== "string" || conversationId.trim() === "") {
        throw new ExtendError("internal", {
          message: "A stop names the conversation whose questions end.",
        });
      }
      const stopped = broker.stop(conversationId, authContext(context));
      return context.json({ stopped });
    } catch (error) {
      return context.json(failure(error), 400);
    }
  });

  return routes;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The reply body: chosen options, written text, or a deferral.
 *
 * Free text and a choice are exclusive on purpose - one body, one meaning. A
 * reply with neither is a refusal to send an answer, not an empty one, and is
 * rejected here rather than recorded as something it was not.
 */
function reply(value: unknown): QuestionReply {
  if (!isRecord(value)) {
    throw new ExtendError("internal", { message: "The answer must be an object." });
  }
  const deferred = value["deferred"] === true;
  const rawOptionIds = value["optionIds"];
  const text = value["text"];

  const optionIds =
    rawOptionIds === undefined
      ? undefined
      : Array.isArray(rawOptionIds) && rawOptionIds.every((entry) => typeof entry === "string")
        ? [...rawOptionIds]
        : undefined;
  const written = text === undefined ? undefined : typeof text === "string" ? text : undefined;

  if (optionIds === undefined && written === undefined && !deferred) {
    throw new ExtendError("internal", {
      message: "An answer names options, writes text, or defers.",
    });
  }
  return {
    ...(optionIds === undefined ? {} : { optionIds }),
    ...(written === undefined ? {} : { text: written }),
    deferred,
  };
}

function failure(error: unknown): { error: string; code: string } {
  const report = toErrorReport(error);
  return { error: report.message, code: report.code };
}
