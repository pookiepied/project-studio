import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

interface SqlPort {
  exec(query: string, ...values: SQLInputValue[]): { toArray(): Record<string, unknown>[] };
}
interface SteeringStore {
  hasSteeringSubmission(host: { submissionId: string; attemptId: string }, agent: string): Promise<boolean>;
}
// Pin the actual patched bundle, rather than a second implementation of its SQL.
const { t: createStore }: {
  t: (sql: SqlPort, transaction: <T>(fn: () => T) => T) => SteeringStore;
} = await import(new URL("./sql-agent-execution-store-LqbFqydc.mjs", import.meta.resolve("@flue/runtime")).href);

describe("live steering scheduling metadata", () => {
  const databases: DatabaseSync[] = [];
  afterEach(() => { for (const database of databases.splice(0)) database.close(); });

  function fixture() {
    const db = new DatabaseSync(":memory:");
    databases.push(db);
    db.exec(`CREATE TABLE flue_agent_submissions (
      sequence INTEGER PRIMARY KEY, submission_id TEXT, session_key TEXT,
      status TEXT, attempt_id TEXT, canonical_ready_at INTEGER,
      abort_requested_at INTEGER, payload TEXT
    )`);
    db.prepare("INSERT INTO flue_agent_submissions VALUES (1, 'host', 'session', 'running', 'attempt', 1, NULL, '{}')").run();
    const queries: string[] = [];
    const store = createStore({ exec(query, ...values) {
      queries.push(query);
      return { toArray: () => db.prepare(query).all(...values) };
    } }, (fn) => fn());
    function add(mode: string, session = "session", ready: number | null = 1, agent = "studio", aborted: number | null = null) {
      db.prepare("INSERT INTO flue_agent_submissions (submission_id, session_key, status, canonical_ready_at, abort_requested_at, payload) VALUES ('pending', ?, 'queued', ?, ?, ?)")
        .run(session, ready, aborted, JSON.stringify({ agent, message: { deliveryMode: mode, attachments: [{ data: "PRIVATE_IMAGE" }] } }));
    }
    return { db, store, add, queries, host: { submissionId: "host", attemptId: "attempt" } };
  }

  it("finds explicit steering past ordinary queued input without claiming or reading image payloads", async () => {
    const { db, store, add, queries, host } = fixture();
    add("queue");
    expect(await store.hasSteeringSubmission(host, "studio")).toBe(false);
    add("steer");
    expect(await store.hasSteeringSubmission(host, "studio")).toBe(true);
    expect(queries.every((query) => query.startsWith("SELECT "))).toBe(true);
    expect(queries.every((query) => !query.includes("SELECT payload") && !query.includes("attachments"))).toBe(true);
    expect(db.prepare("SELECT status FROM flue_agent_submissions ORDER BY sequence").all()).toEqual([
      { status: "running" }, { status: "queued" }, { status: "queued" },
    ]);
  });

  it("binds the check to the active host, attempt and session", async () => {
    const { db, store, add, host } = fixture();
    add("steer", "another-session");
    expect(await store.hasSteeringSubmission(host, "studio")).toBe(false);
    add("steer");
    expect(await store.hasSteeringSubmission({ ...host, attemptId: "stale-attempt" }, "studio")).toBe(false);
    expect(await store.hasSteeringSubmission({ ...host, submissionId: "other-host" }, "studio")).toBe(false);
    db.prepare("UPDATE flue_agent_submissions SET abort_requested_at = 1 WHERE submission_id = 'host'").run();
    expect(await store.hasSteeringSubmission(host, "studio")).toBe(false);
  });

  it.each(["unready", "aborted", "another-agent"])("waits behind an %s queue prefix", async (blocker) => {
    const { store, add, host } = fixture();
    add("queue", "session", blocker === "unready" ? null : 1, blocker === "another-agent" ? "other" : "studio", blocker === "aborted" ? 1 : null);
    add("steer");
    expect(await store.hasSteeringSubmission(host, "studio")).toBe(false);
  });

  it("preserves storage failures", async () => {
    const failure = new Error("Unavailable scheduling store");
    const store = createStore({ exec() { throw failure; } }, (fn) => fn());
    await expect(store.hasSteeringSubmission({ submissionId: "host", attemptId: "attempt" }, "studio")).rejects.toBe(failure);
  });
});
