import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { FlueObservation } from "@flue/runtime";

import { TaskStore } from "../../src/agents/definitions/task-store.js";
import {
  TaskProjector,
  taskEndedLine,
} from "../../src/agents/task-projector.js";
import { isSettledTaskStatus, IMPROVE_AGENT_ID, TITLE_AGENT_ID } from "../../src/contracts/agents.js";
import { JobPings } from "../../src/process/job-pings.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The settlement projector (ADR 0058 D5, S4.1/S4.2): the TaskStore's row is a
 * projection of the stream, and these tests drive the projection with
 * settlements injected through the same seam the titler's tests use.
 *
 * The behaviors under proof, each because a docblock claims it:
 * - completed / failed / aborted map onto the row with the summary the
 *   `agent_end` capture gives them;
 * - an instance with no row is nobody's business;
 * - the row write is idempotent under replay (the same settlement seen
 *   twice writes the same answer), and the announce fires on the
 *   transition only - the projector's half of the S4.5 rule that a replayed
 *   settlement re-dispatches nothing;
 * - a task with a parent conversation announces exactly once, through the
 *   injected hub recorder; one without settles silently.
 */

let db: StudioDatabase;
let tasks: TaskStore;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  tasks = new TaskStore(db);
});

afterEach(() => {
  db.close();
});

/** A run's final assistant text, as the runtime's `agent_end` carries it. */
function agentEnd(instanceId: string, text: string): FlueObservation {
  return {
    type: "agent_end",
    instanceId,
    agentName: IMPROVE_AGENT_ID,
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text }],
        // The fields below are required on the wire message; the projector
        // reads only role and content, so honest dummies keep the shape.
        api: "project-studio-test",
        provider: "project-studio-test",
        model: "default",
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        stopReason: "stop",
        timestamp: Date.now(),
      },
    ],
  } as unknown as FlueObservation;
}

function settled(
  instanceId: string,
  outcome: "completed" | "failed" | "aborted",
  error?: { message: string },
): FlueObservation {
  return {
    type: "submission_settled",
    instanceId,
    agentName: IMPROVE_AGENT_ID,
    submissionId: "sub_1",
    outcome,
    ...(error === undefined ? {} : { error }),
  } as unknown as FlueObservation;
}

interface Hub {
  readonly announced: string[];
  readonly bodies: string[];
  readonly pings: JobPings;
}

/**
 * A hub wired the way the runtime wires it: the tasks source is registered
 * on it, so an announce collects the settled-but-untold rows' lines and the
 * delivery is only made when there is something to deliver. A hub without
 * the source would deliver nothing and prove nothing.
 */
function hubWith(tasks: TaskStore): Hub {
  const announced: string[] = [];
  const bodies: string[] = [];
  const told = new Set<string>();
  const pings = new JobPings({
    deliver: async (conversationId, body) => {
      announced.push(conversationId);
      bodies.push(body);
    },
  });
  pings.addSource({
    drain: (conversationId) => {
      const lines: string[] = [];
      for (const record of tasks.list({ parentConversationId: conversationId })) {
        if (!isSettledTaskStatus(record.status) || told.has(record.id)) continue;
        told.add(record.id);
        lines.push(taskEndedLine(record));
      }
      return lines;
    },
  });
  return { announced, bodies, pings };
}

describe("the task projector", () => {
  it("settles completed with the captured final text as the summary", () => {
    const delivered: ((observation: FlueObservation) => void)[] = [];
    const projector = new TaskProjector({
      tasks,
      subscribe: (handler) => {
        delivered.push(handler);
        return () => undefined;
      },
    });
    projector.start();

    tasks.record({ id: "cnv_a-t1", agentName: TITLE_AGENT_ID });
    for (const handler of delivered) {
      handler(agentEnd("cnv_a-t1", "Refactoring the sandbox factory\nsecond line"));
      handler(settled("cnv_a-t1", "completed"));
    }

    const row = tasks.get("cnv_a-t1");
    expect(row?.status).toBe("completed");
    expect(row?.resultSummary).toBe("Refactoring the sandbox factory");
    expect(row?.settledAt).toBeTypeOf("number");
  });

  it("maps aborted to cancelled and failed to the settlement's error", () => {
    const delivered: ((observation: FlueObservation) => void)[] = [];
    new TaskProjector({
      tasks,
      subscribe: (handler) => {
        delivered.push(handler);
        return () => undefined;
      },
    }).start();

    tasks.record({ id: "imp_stop", agentName: IMPROVE_AGENT_ID });
    tasks.record({ id: "imp_fail", agentName: IMPROVE_AGENT_ID });
    for (const handler of delivered) {
      handler(settled("imp_stop", "aborted"));
      handler(settled("imp_fail", "failed", { message: "the model had a bad day" }));
    }

    expect(tasks.get("imp_stop")?.status).toBe("cancelled");
    expect(tasks.get("imp_fail")?.status).toBe("failed");
    expect(tasks.get("imp_fail")?.resultSummary).toBe("the model had a bad day");
  });

  it("ignores settlements for instances with no row", () => {
    const delivered: ((observation: FlueObservation) => void)[] = [];
    new TaskProjector({
      tasks,
      subscribe: (handler) => {
        delivered.push(handler);
        return () => undefined;
      },
    }).start();

    for (const handler of delivered) {
      // A conversation's own instance id - the studio agent's - and a
      // delegate child riding its parent's id: neither is indexed, neither
      // is the projector's business.
      handler(settled("cnv_conversation", "completed"));
      handler(agentEnd("cnv_conversation", "a conversation reply"));
    }
    expect(tasks.list()).toEqual([]);
  });

  it("replays a settlement without changing the row or re-announcing", () => {
    const delivered: ((observation: FlueObservation) => void)[] = [];
    const hub = hubWith(tasks);
    new TaskProjector({
      tasks,
      pings: hub.pings,
      subscribe: (handler) => {
        delivered.push(handler);
        return () => undefined;
      },
    }).start();

    tasks.record({
      id: "cnv_a-t1",
      agentName: TITLE_AGENT_ID,
      parentConversationId: "cnv_a",
    });
    // The first settlement already happened - a live run, or one whose ending
    // this projector saw before. A sentinel timestamp the clock cannot
    // collide with, and the settled status the transition check reads.
    tasks.setStatus("cnv_a-t1", "completed", "Titled.");
    db.prepare("UPDATE agent_task SET settled_at = 12345 WHERE id = 'cnv_a-t1'").run();
    const first = tasks.get("cnv_a-t1");

    for (const handler of delivered) {
      // Two settlements of the same submission: the first is the live run's,
      // the second is the replay a restart's recovery produces. The row is
      // already terminal when the second arrives - read off the store, not
      // remembered - so the row keeps its first answer.
      handler(settled("cnv_a-t1", "completed"));
    }
    const after = tasks.get("cnv_a-t1");
    expect(after?.status).toBe(first?.status);
    expect(after?.settledAt).toBe(12345);
    expect(after?.resultSummary).toBe(first?.resultSummary);
    // No announce fired either: the settlement found the row terminal, and
    // a settled task's news was delivered with its first settlement.
    expect(hub.announced).toEqual([]);
  });

  it("announces a settled task to its parent conversation exactly once", () => {
    const delivered: ((observation: FlueObservation) => void)[] = [];
    const hub = hubWith(tasks);
    new TaskProjector({
      tasks,
      pings: hub.pings,
      subscribe: (handler) => {
        delivered.push(handler);
        return () => undefined;
      },
    }).start();

    tasks.record({
      id: "cnv_b-task-1",
      agentName: IMPROVE_AGENT_ID,
      parentConversationId: "cnv_b",
      title: "Summarize the folder",
    });
    for (const handler of delivered) {
      handler(agentEnd("cnv_b-task-1", "Done reading."));
      handler(settled("cnv_b-task-1", "completed"));
    }

    expect(hub.announced).toEqual(["cnv_b"]);
  });

  it("settles silently for a task whose dispatch named no parent", () => {
    const delivered: ((observation: FlueObservation) => void)[] = [];
    const hub = hubWith(tasks);
    new TaskProjector({
      tasks,
      pings: hub.pings,
      subscribe: (handler) => {
        delivered.push(handler);
        return () => undefined;
      },
    }).start();

    tasks.record({ id: "dsc_1", agentName: "describe" });
    for (const handler of delivered) {
      handler(agentEnd("dsc_1", "A picture of a lighthouse."));
      handler(settled("dsc_1", "completed"));
    }

    expect(tasks.get("dsc_1")?.status).toBe("completed");
    expect(hub.announced).toEqual([]);
  });
});
