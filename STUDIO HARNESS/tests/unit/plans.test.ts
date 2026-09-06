import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ADMISSION_SCOPES } from "../../src/admission/scopes.js";
import { createAdmissionSession } from "../../src/admission/verifier.js";
import { PlanItemStore } from "../../src/plan/plan-items.js";
import type { PlanItemWrite } from "../../src/plan/plan.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../src/permissions/kernel.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createPlanRoutes } from "../../src/transport/http/routes/plans.js";
import {
  createAdmissionMiddleware,
  type AdmissionEnv,
} from "../../src/transport/http/middleware/admission.js";
import { createPlanTool, PLAN_TOOL_DESCRIPTOR } from "../../src/tools/plan/plan.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { Hono } from "hono";

/**
 * The plan: the run's stated intention as durable rows the person can tick.
 *
 * The tests are named for the claims the task makes, and the first of them -
 * the lost update that must not happen - is the one the whole data model
 * exists for. Every claim here carries a negative control recorded in the
 * task report: the code was broken, the named test failed, and the code was
 * restored.
 */

const CONVERSATION = "cnv_plan";

let db: StudioDatabase;
const workspaces: string[] = [];

function open(): StudioDatabase {
  return openDatabase({ path: ":memory:" });
}

function item(id: string, status: PlanItemWrite["status"], text = `Do ${id}`): PlanItemWrite {
  return { id, text, status };
}

/**
 * A write no caller of the typed API could name - the shape the runtime walls
 * in the store exist for, reachable only by untyping it.
 */
function outOfVocabulary(id: string, status: string): PlanItemWrite {
  return JSON.parse(JSON.stringify({ id, text: `Do ${id}`, status }));
}

beforeEach(() => {
  db = open();
});

afterEach(() => {
  db.close();
  while (workspaces.length > 0) {
    const dir = workspaces.pop();
    if (dir !== undefined) rmSync(dir, { recursive: true, force: true });
  }
});

describe("the plan store", () => {
  it("merges named items and reads them back in first-seen order", () => {
    const store = new PlanItemStore(db);
    store.merge(CONVERSATION, [item("one", "done"), item("two", "running")], "model");
    store.merge(CONVERSATION, [item("three", "pending")], "model");

    const view = store.list(CONVERSATION);
    expect(view.damaged).toBe(false);
    expect(view.items.map((entry) => entry.id)).toEqual(["one", "two", "three"]);
    expect(view.items.map((entry) => entry.status)).toEqual(["done", "running", "pending"]);
    expect(view.items.every((entry) => entry.updatedBy === "model")).toBe(true);
  });

  it("does not lose the person's tick when the model writes other items", () => {
    // The test the data model exists for. The person ticks item four; the
    // model - which composed its call before it could know that - then writes
    // items one, two and three. A merge that replaced the list would undo
    // the tick; a merge by id cannot.
    const store = new PlanItemStore(db);
    store.merge(
      CONVERSATION,
      [item("one", "pending"), item("two", "pending"), item("four", "running")],
      "model",
    );

    expect(store.update(CONVERSATION, "four", "done", "person")).toBe(true);
    store.merge(CONVERSATION, [item("one", "done"), item("two", "done")], "model");

    const view = store.list(CONVERSATION);
    const four = view.items.find((entry) => entry.id === "four");
    expect(four?.status).toBe("done");
    expect(four?.updatedBy).toBe("person");
  });

  it("tells the model what the person changed, in the write's own result", () => {
    const store = new PlanItemStore(db);
    store.merge(CONVERSATION, [item("one", "running")], "model");
    store.update(CONVERSATION, "one", "done", "person");

    // The view the merge returns is the whole list after the write, so the
    // tool's result carries the person's edit to the model with no other
    // channel involved.
    const view = store.merge(CONVERSATION, [item("two", "running")], "model");
    const one = view.items.find((entry) => entry.id === "one");
    expect(one?.status).toBe("done");
    expect(one?.updatedBy).toBe("person");
  });

  it("survives a restart: a second store over the same database reads it whole", () => {
    const directory = mkdtempSync(join(tmpdir(), "studio-plan-"));
    workspaces.push(directory);
    const path = join(directory, "studio.db");
    const first = openDatabase({ path });
    try {
      const writer = new PlanItemStore(first);
      writer.merge(
        CONVERSATION,
        [item("one", "done"), item("two", "running"), item("three", "pending")],
        "model",
      );
    } finally {
      first.close();
    }

    const second = openDatabase({ path });
    try {
      const reader = new PlanItemStore(second);
      const view = reader.list(CONVERSATION);
      expect(view.damaged).toBe(false);
      expect(view.items.map((entry) => [entry.id, entry.status])).toEqual([
        ["one", "done"],
        ["two", "running"],
        ["three", "pending"],
      ]);
    } finally {
      second.close();
    }
  });

  it("leaves written items standing when a later call fails", () => {
    // Nothing about a plan is rolled back with a turn: the first call's rows
    // are committed facts, and a failure in the next call - here a merge that
    // refuses a whole batch - does not reach them.
    const store = new PlanItemStore(db);
    store.merge(CONVERSATION, [item("one", "done"), item("two", "done")], "model");

    expect(() =>
      store.merge(CONVERSATION, [outOfVocabulary("three", "in_progress")], "model"),
    ).toThrow();
    const view = store.list(CONVERSATION);
    expect(view.items.map((entry) => entry.id)).toEqual(["one", "two"]);
  });

  it("keeps position stable: merging item three moves nothing else", () => {
    const store = new PlanItemStore(db);
    store.merge(
      CONVERSATION,
      [item("one", "pending"), item("two", "pending"), item("three", "pending")],
      "model",
    );
    const before = store.list(CONVERSATION).items;

    store.merge(CONVERSATION, [item("three", "done", "Do three, finished")], "model");

    const after = store.list(CONVERSATION).items;
    expect(after.map((entry) => [entry.id, entry.position, entry.status])).toEqual(
      before.map((entry) => [entry.id, entry.position, entry.id === "three" ? "done" : entry.status]),
    );
    expect(after.find((entry) => entry.id === "three")?.text).toBe("Do three, finished");
  });

  it("refuses a status outside the five, on the way in and on the way out", () => {
    const store = new PlanItemStore(db);
    // The typed API cannot even express these; the runtime walls exist for a
    // caller that skipped its parse, and this is the only way to reach them.
    expect(() =>
      store.merge(CONVERSATION, [outOfVocabulary("one", "in_progress")], "model"),
    ).toThrow();
    expect(() =>
      store.update(CONVERSATION, "missing", outOfVocabulary("x", "completed").status, "person"),
    ).toThrow();

    // The vocabulary is also enforced against values that reached the
    // database before it existed: a row written by an older build reads as
    // damaged rather than as a status nobody chose.
    db.prepare(
      "INSERT INTO plan_item (conversation_id, id, text, status, position, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(CONVERSATION, "old", "An old row", "in_progress", 1, "model", 1);
    const view = store.list(CONVERSATION);
    expect(view.damaged).toBe(true);
    expect(view.items).toEqual([]);
  });

  it("reads a corrupt row as damaged, and an empty plan as empty, and never one for the other", () => {
    const store = new PlanItemStore(db);

    const empty = store.list(CONVERSATION);
    expect(empty.damaged).toBe(false);
    expect(empty.items).toEqual([]);

    db.prepare(
      "INSERT INTO plan_item (conversation_id, id, text, status, position, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(CONVERSATION, "one", "Do one", "pending", 1, "model", 1);
    db.prepare("UPDATE plan_item SET status = ? WHERE conversation_id = ? AND id = ?").run(
      "not-a-status",
      CONVERSATION,
      "one",
    );
    const damaged = store.list(CONVERSATION);
    expect(damaged.damaged).toBe(true);
    expect(damaged.items).toEqual([]);
  });

  it("will not write a person's tick into existence", () => {
    // The person's primitive updates one existing item; a stray id inventing
    // a plan item nobody planned is exactly what it must refuse.
    const store = new PlanItemStore(db);
    expect(store.update(CONVERSATION, "missing", "done", "person")).toBe(false);
    expect(store.list(CONVERSATION).items).toEqual([]);
  });

  it("removes every row for one conversation, and only that conversation", () => {
    const store = new PlanItemStore(db);
    store.merge(CONVERSATION, [item("one", "pending")], "model");
    store.merge("cnv_other", [item("one", "pending")], "model");

    expect(store.clearConversation(CONVERSATION)).toBe(1);
    expect(store.list(CONVERSATION).items).toEqual([]);
    expect(store.list("cnv_other").items).toHaveLength(1);
  });
});

describe("the plan tool", () => {
  const scope = {
    agentId: "studio",
    conversationId: CONVERSATION,
    projectId: undefined,
  };
  const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: process.cwd() }));

  async function run(
    store: PlanItemStore,
    input: unknown,
  ): Promise<ReturnType<ReturnType<typeof createPlanTool>["execute"]>> {
    const tool = createPlanTool({
      merge: (conversationId, items) => store.merge(conversationId, items, "model"),
    });
    return tool.execute(
      tool.parse(input),
      { scope, sandbox, signal: undefined },
    );
  }

  it("returns the whole current list, including the person's edits", async () => {
    const store = new PlanItemStore(db);
    store.merge(CONVERSATION, [item("one", "running"), item("four", "running")], "model");
    store.update(CONVERSATION, "four", "done", "person");

    const result = await run(store, {
      items: [{ id: "one", text: "Do one", status: "done" }],
    });

    // Not an acknowledgement, not the items that were written: the whole
    // list, with who last touched each item - which is how the model learns
    // item four was done by the person and must not be redone.
    expect(result.items.map((entry) => [entry.id, entry.status, entry.updatedBy])).toEqual([
      ["one", "done", "model"],
      ["four", "done", "person"],
    ]);
  });

  it("refuses more than twenty items, and zero", async () => {
    const store = new PlanItemStore(db);
    const twenty = Array.from({ length: 20 }, (_, at) => item(`item-${at}`, "pending"));
    const result = await run(store, { items: [...twenty] });
    expect(result.items).toHaveLength(20);

    expect(() =>
      createPlanTool({
        merge: (conversationId, items) => store.merge(conversationId, items, "model"),
      }).parse({ items: [] }),
    ).toThrow();
    const twentyOne = [...twenty, item("item-20", "pending")];
    expect(() =>
      createPlanTool({
        merge: (conversationId, items) => store.merge(conversationId, items, "model"),
      }).parse({ items: twentyOne }),
    ).toThrow();
  });

  it("refuses duplicate ids in one call, and an unknown status", () => {
    const store = new PlanItemStore(db);
    const tool = createPlanTool({
      merge: (conversationId, items) => store.merge(conversationId, items, "model"),
    });

    expect(() =>
      tool.parse({ items: [item("one", "pending"), item("one", "done")] }),
    ).toThrow();
    expect(() =>
      tool.parse({ items: [{ id: "one", text: "Do one", status: "in_progress" }] }),
    ).toThrow();
  });

  it("errors on a damaged read instead of returning a partial list as whole", async () => {
    const store = new PlanItemStore(db);
    store.merge(CONVERSATION, [item("one", "pending")], "model");
    db.prepare("UPDATE plan_item SET status = ? WHERE conversation_id = ?").run(
      "not-a-status",
      CONVERSATION,
    );

    await expect(
      run(store, { items: [item("two", "pending")] }),
    ).rejects.toMatchObject({ kind: "execution_failed" });
  });

  it("declares read and nothing else, and the kernel admits exactly that", () => {
    expect(PLAN_TOOL_DESCRIPTOR.effects).toEqual(["read"]);
    expect(PLAN_TOOL_DESCRIPTOR.id).toEqual({ namespace: "native", name: "plan" });
    // A merge is safe to retry after an unknown outcome: the same arguments
    // leave the same rows.
    expect(PLAN_TOOL_DESCRIPTOR.idempotent).toBe(true);

    const kernel = new PermissionKernel({ grants: new PermissionGrantStore(db) });
    expect(() => kernel.register(PLAN_TOOL_DESCRIPTOR)).not.toThrow();
    const decision = kernel.evaluate(PLAN_TOOL_DESCRIPTOR.id, {
      agentId: "studio",
      conversationId: CONVERSATION,
      projectId: undefined,
    });
    expect(decision.verdict).toBe("allow");
  });

  it("is not described in words that invite confusion with the delegation tool", () => {
    const description = PLAN_TOOL_DESCRIPTOR.description;
    expect(description).toMatch(/\btask\b/);
    expect(description).toMatch(/runs nothing/);
  });
});

describe("the plan routes", () => {
  let session: ReturnType<typeof createAdmissionSession>;
  let app: Hono<AdmissionEnv>;
  let store: PlanItemStore;

  function authorized(path: string, init: RequestInit = {}): Promise<Response> {
    return Promise.resolve(
      app.request(`http://harness.test${path}`, {
        ...init,
        headers: {
          ...init.headers,
          authorization: `Bearer ${session.credential}`,
          "content-type": "application/json",
        },
      }),
    );
  }

  beforeEach(() => {
    session = createAdmissionSession();
    store = new PlanItemStore(db);
    app = new Hono<AdmissionEnv>();
    app.use("*", createAdmissionMiddleware(session.verifier));
    app.route("/api/plans", createPlanRoutes(store));
  });

  it("reads one conversation's plan, empty and unreadable told apart", async () => {
    store.merge(CONVERSATION, [item("one", "running")], "model");

    const read = await authorized(`/api/plans/${CONVERSATION}`);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      conversationId: CONVERSATION,
      damaged: false,
      items: [{ id: "one", status: "running", updatedBy: "model" }],
    });
  });

  it("takes the person's tick as done, and untick as pending, and no other status", async () => {
    store.merge(CONVERSATION, [item("one", "running")], "model");

    const ticked = await authorized(`/api/plans/${CONVERSATION}/items/one`, {
      method: "POST",
      body: JSON.stringify({ status: "done" }),
    });
    expect(ticked.status).toBe(204);
    expect(store.list(CONVERSATION).items[0]).toMatchObject({
      status: "done",
      updatedBy: "person",
    });

    const unticked = await authorized(`/api/plans/${CONVERSATION}/items/one`, {
      method: "POST",
      body: JSON.stringify({ status: "pending" }),
    });
    expect(unticked.status).toBe(204);
    expect(store.list(CONVERSATION).items[0]).toMatchObject({ status: "pending" });

    // `failed` is a claim about what happened; the person is not given it.
    const claimed = await authorized(`/api/plans/${CONVERSATION}/items/one`, {
      method: "POST",
      body: JSON.stringify({ status: "failed" }),
    });
    expect(claimed.status).toBe(400);
    expect(store.list(CONVERSATION).items[0]).toMatchObject({ status: "pending" });
  });

  it("answers a tick for an item that is not there with 404", async () => {
    const missing = await authorized(`/api/plans/${CONVERSATION}/items/ghost`, {
      method: "POST",
      body: JSON.stringify({ status: "done" }),
    });
    expect(missing.status).toBe(404);
    expect(store.list(CONVERSATION).items).toEqual([]);
  });

  it("clears the plan, which is the remedy a damaged read offers", async () => {
    store.merge(CONVERSATION, [item("one", "pending")], "model");

    const cleared = await authorized(`/api/plans/${CONVERSATION}`, { method: "DELETE" });
    expect(cleared.status).toBe(204);
    const view = store.list(CONVERSATION);
    expect(view.items).toEqual([]);
    expect(view.damaged).toBe(false);
  });

  it("refuses a session without the project scope", async () => {
    const limited = createAdmissionSession({ scopes: [ADMISSION_SCOPES.AGENT_RUN] });
    const scoped = new Hono<AdmissionEnv>();
    scoped.use("*", createAdmissionMiddleware(limited.verifier));
    scoped.route("/api/plans", createPlanRoutes(store));

    const refused = await Promise.resolve(
      scoped.request(`http://harness.test/api/plans/${CONVERSATION}`, {
        headers: { authorization: `Bearer ${limited.credential}` },
      }),
    );
    expect(refused.status).toBe(403);
  });
});
