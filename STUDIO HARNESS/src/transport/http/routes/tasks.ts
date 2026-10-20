import { Hono } from "hono";

import { ADMISSION_SCOPES } from "../../../admission/scopes.js";
import type {
  AgentTaskRecord,
  TaskStore,
} from "../../../agents/definitions/task-store.js";
import { isSettledTaskStatus } from "../../../contracts/agents.js";
import { requireAdmissionScope, type AdmissionEnv } from "../middleware/admission.js";
import { steerTask } from "../../../agents/task-control.js";
import { toErrorReport } from "../../../observability/error-reporter.js";

/**
 * The background agent tasks' routes (ADR 0058 D5, S4.1).
 *
 * The TaskStore's rows are what the rail's Tasks section and the task cards
 * read, and these are the three verbs the product needs over them: list what
 * exists, read one, stop one. The rows are an index — Flue's stream is the
 * canonical transcript — so nothing here serves text: what a task's own
 * transcript is and how it is addressed is the D10 decision, recorded as
 * ADR 0058's amendment, and it does not pass through this module.
 *
 * Guarded by the `agent:run` scope, the same one the agent router holds.
 * These are agent work: the client trusted to run and stop a conversation's
 * responses is trusted to watch and stop the tasks the harness dispatched,
 * and no second scope is minted for a surface whose authority question is
 * the same one.
 */
export interface TaskControlPort {
  readonly activity?: (conversationId: string) => readonly import("../../../agents/task-projector.js").TaskActivity[];
  /**
   * Stops one task's durable work, answering whether there was something to
   * stop. Resolves once the abort intent is recorded; the settlement lands
   * asynchronously on the stream and reaches the row through the projector.
   * The port, not the route, owns how — the composition root maps it to
   * Flue's instance abort for the row's registered agent, and a test can
   * inject a recorder.
   */
  readonly cancel: (task: AgentTaskRecord) => Promise<boolean>;
}

export function createTaskRoutes(
  tasks: TaskStore,
  control: TaskControlPort,
): Hono<AdmissionEnv> {
  const routes = new Hono<AdmissionEnv>();
  routes.use("*", requireAdmissionScope(ADMISSION_SCOPES.AGENT_RUN));

  routes.get("/", (context) => {
    // A query parameter names a column to conjoin; an absent one says
    // nothing about that column. Ordering - newest first - is the store's
    // own rule and is not re-decided here.
    const agentName = context.req.query("agentName");
    const parentConversationId = context.req.query("parentConversationId");
    return context.json(
      tasks.list({
        ...(agentName === undefined ? {} : { agentName }),
        ...(parentConversationId === undefined ? {} : { parentConversationId }),
      }),
    );
  });

  routes.get("/activity", (context) => {
    const conversationId = context.req.query("parentConversationId");
    if (!conversationId) return context.json({ error: "Choose a conversation to inspect." }, 400);
    return context.json({ tasks: control.activity?.(conversationId) ?? [], evidence: "live_process" });
  });

  routes.get("/:id", (context) => {
    const record = tasks.get(context.req.param("id"));
    return record === undefined
      ? context.json({ error: "That task does not exist." }, 404)
      : context.json(record);
  });

  routes.post("/:id/cancel", async (context) => {
    const record = tasks.get(context.req.param("id"));
    if (record === undefined) {
      return context.json({ error: "That task does not exist." }, 404);
    }
    // A settled task has nothing left to stop, and saying so beats pretending:
    // the cancel is answered, the row is untouched, and the rail's next read
    // shows the state that was already true when the button was pressed.
    if (isSettledTaskStatus(record.status)) {
      return context.json({ cancelled: false });
    }
    const cancelled = await control.cancel(record);
    return context.json({ cancelled });
  });

  routes.post("/:id/steer", async (context) => {
    const task = tasks.get(context.req.param("id"));
    if (task === undefined) return context.json({ error: "That task does not exist." }, 404);
    try {
      const body: unknown = await context.req.json();
      if (typeof body !== "object" || body === null || !("text" in body) || typeof body.text !== "string") {
        return context.json({ error: "Provide the correction as text." }, 400);
      }
      const submissionId = await steerTask(task, body.text);
      return context.json({ submissionId, status: "steering_admitted" });
    } catch (error) { return context.json({ error: toErrorReport(error).message }, 400); }
  });

  return routes;
}
