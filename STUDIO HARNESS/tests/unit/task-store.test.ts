import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskStore } from "../../src/agents/definitions/task-store.js";
import { AgentRegistryError } from "../../src/agents/definitions/registry.js";
import { IMPROVE_AGENT_ID, STUDIO_AGENT_ID, TITLE_AGENT_ID } from "../../src/contracts/agents.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * The task index (ADR 0058 D5, Stage 2: the store, no routes).
 *
 * Every assertion here is about the three properties the store's docblock
 * claims: it is an index (rows point, they do not hold answers), it is not
 * a scheduler (nothing dispatches or retries), and its statuses are the
 * shared settlement vocabulary rather than a new one.
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

describe("the task index", () => {
  it("records a dispatched task as running, keyed by its instance id", () => {
    const record = tasks.record({
      id: "imp_1234",
      agentName: IMPROVE_AGENT_ID,
      title: "Tidy a dictated take",
    });

    expect(record.status).toBe("running");
    expect(record.agentName).toBe(IMPROVE_AGENT_ID);
    expect(record.title).toBe("Tidy a dictated take");
    expect(tasks.get("imp_1234")?.id).toBe("imp_1234");
  });

  it("defaults the title to the definition's own title", () => {
    const record = tasks.record({ id: "cnv_a-t1", agentName: TITLE_AGENT_ID });
    expect(record.title).toBe("Titler");
  });

  it("refuses a task row for an agent that is not a background definition", () => {
    // `studio` is a conversation agent, and the mounted agent is not a
    // task; the refusal keeps the index honest about what it indexes.
    expect(() =>
      tasks.record({ id: "cnv_a", agentName: STUDIO_AGENT_ID }),
    ).toThrow(AgentRegistryError);
  });

  it("refuses a task row for an agent that does not exist", () => {
    expect(() => tasks.record({ id: "x_1", agentName: "reviewer" })).toThrow(AgentRegistryError);
  });

  it("settles a status with a timestamp and a summary, once", () => {
    tasks.record({ id: "imp_1", agentName: IMPROVE_AGENT_ID });
    // A sentinel the clock cannot collide with: the second setStatus must
    // keep THIS timestamp, and Date.now() called twice in one test can
    // return the same millisecond, which would pass a broken implementation.
    db.prepare("UPDATE agent_task SET settled_at = 12345 WHERE id = 'imp_1'").run();
    expect(tasks.setStatus("imp_1", "completed", "Tidied.")).toBe(true);

    const settled = tasks.get("imp_1");
    expect(settled?.status).toBe("completed");
    expect(settled?.settledAt).toBe(12345);
    expect(settled?.resultSummary).toBe("Tidied.");

    // Recovery replay: the projector may see the same settlement twice, and
    // the second write is the same answer - the timestamp stays the first
    // one's, which is what "settled once" means.
    tasks.setStatus("imp_1", "completed", "Tidied.");
    expect(tasks.get("imp_1")?.settledAt).toBe(12345);
  });

  it("reads a status it cannot parse as unknown rather than refusing the row", () => {
    tasks.record({ id: "imp_2", agentName: IMPROVE_AGENT_ID });
    // A row written by a future schema the reader does not know - the store
    // treats it as a state it cannot prove, not an error.
    db.prepare("UPDATE agent_task SET status = 'hibernating' WHERE id = 'imp_2'").run();
    expect(tasks.get("imp_2")?.status).toBe("unknown");
  });

  it("lists newest first, narrowed by agent and by parent conversation", () => {
    tasks.record({ id: "imp_a", agentName: IMPROVE_AGENT_ID, parentConversationId: "cnv_1" });
    tasks.record({ id: "dsc_b", agentName: "describe", parentConversationId: "cnv_2" });
    tasks.record({ id: "imp_c", agentName: IMPROVE_AGENT_ID });

    expect(tasks.list().map((task) => task.id)).toEqual(["imp_c", "dsc_b", "imp_a"]);
    expect(tasks.list({ agentName: IMPROVE_AGENT_ID }).map((task) => task.id)).toEqual([
      "imp_c",
      "imp_a",
    ]);
    expect(
      tasks.list({ parentConversationId: "cnv_1" }).map((task) => task.id),
    ).toEqual(["imp_a"]);
  });

  it("deletes a conversation's task rows for the purge path", () => {
    tasks.record({ id: "imp_a", agentName: IMPROVE_AGENT_ID, parentConversationId: "cnv_1" });
    tasks.record({ id: "imp_b", agentName: IMPROVE_AGENT_ID, parentConversationId: "cnv_2" });

    expect(tasks.deleteConversation("cnv_1")).toBe(1);
    expect(tasks.get("imp_a")).toBeUndefined();
    expect(tasks.get("imp_b")).toBeDefined();
  });

  it("carries the migration's table with the expected columns", () => {
    // The migration is append-only; this pins the shape the store reads, so
    // a future migration that touches `agent_task` fails here rather than
    // in the store's runtime path.
    const columns = db
      .prepare("PRAGMA table_info(agent_task)")
      .all()
      .map((column) => (column as { name: string }).name);
    expect(columns).toEqual([
      "id",
      "agent_name",
      "parent_conversation_id",
      "origin_submission_id",
      "title",
      "status",
      "created_at",
      "settled_at",
      "result_summary",
    ]);
  });
});
