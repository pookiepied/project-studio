import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  deleteFlueJournalForConversation,
  hasActiveFlueSubmissions,
  sessionKeyBelongsTo,
  streamPathBelongsTo,
} from "../../src/storage/flue-journal-delete.js";
import { StorageError } from "../../src/storage/errors.js";

/**
 * Deletion is the one irreversible operation in the product, so its tests
 * are written first and broken on purpose.
 *
 * Every test runs against a throwaway journal file holding the live 2.0
 * table shapes (measured against the user's real `flue.db` on 2026-09-04),
 * never against the user's data. The live-runtime test at the bottom holds
 * the file open through Flue's own adapter while deleting, which is the
 * serialization proof the module's docblock promises.
 */

const META_DDL = `CREATE TABLE flue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`;
const STREAMS_DDL = `CREATE TABLE flue_conversation_streams (
  path TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL,
  next_offset INTEGER NOT NULL DEFAULT 0,
  producer_id TEXT,
  producer_epoch INTEGER NOT NULL DEFAULT 0,
  next_producer_sequence INTEGER NOT NULL DEFAULT 0,
  incarnation TEXT NOT NULL
)`;
const BATCHES_DDL = `CREATE TABLE flue_conversation_stream_batches (
  path TEXT NOT NULL,
  seq INTEGER NOT NULL,
  producer_id TEXT NOT NULL,
  producer_epoch INTEGER NOT NULL,
  producer_sequence INTEGER NOT NULL,
  data TEXT NOT NULL,
  submission_id TEXT,
  attempt_id TEXT,
  PRIMARY KEY (path, seq),
  UNIQUE (path, producer_id, producer_epoch, producer_sequence)
)`;
const BATCH_CHUNKS_DDL = `CREATE TABLE flue_conversation_stream_batch_chunks (
  path TEXT NOT NULL,
  seq INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
  data TEXT NOT NULL,
  PRIMARY KEY (path, seq, chunk_index)
)`;
const FOLD_DDL = `CREATE TABLE flue_conversation_fold_checkpoints (
  path TEXT PRIMARY KEY,
  head_offset TEXT NOT NULL,
  incarnation TEXT NOT NULL,
  format_version INTEGER NOT NULL,
  data TEXT,
  chunk_count INTEGER
)`;
const FOLD_CHUNKS_DDL = `CREATE TABLE flue_conversation_fold_checkpoint_chunks (
  path TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  data TEXT NOT NULL,
  PRIMARY KEY (path, chunk_index)
)`;
const ATTACHMENTS_DDL = `CREATE TABLE flue_attachments (
  stream_path TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  digest TEXT NOT NULL,
  conversation_id TEXT NOT NULL,
  chunk_count INTEGER NOT NULL CHECK (chunk_count > 0),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (stream_path, attachment_id)
)`;
const ATTACHMENT_CHUNKS_DDL = `CREATE TABLE flue_attachment_chunks (
  stream_path TEXT NOT NULL,
  attachment_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
  bytes BLOB NOT NULL,
  PRIMARY KEY (stream_path, attachment_id, chunk_index),
  FOREIGN KEY (stream_path, attachment_id)
    REFERENCES flue_attachments (stream_path, attachment_id) ON DELETE CASCADE
)`;
const SUBMISSIONS_DDL = `CREATE TABLE flue_agent_submissions (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id TEXT NOT NULL UNIQUE,
  session_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL,
  accepted_at INTEGER NOT NULL,
  canonical_ready_at INTEGER,
  attempt_id TEXT,
  input_applied_at INTEGER,
  abort_requested_at INTEGER,
  started_at INTEGER,
  joined_into TEXT,
  settled_at INTEGER,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 10,
  timeout_at INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  settlement_record_id TEXT,
  settlement_record TEXT
)`;
const SUBMISSION_CHUNKS_DDL = `CREATE TABLE flue_submission_chunks (
  submission_id TEXT NOT NULL,
  item_id TEXT NOT NULL,
  chunk_index INTEGER NOT NULL,
  chunk_count INTEGER NOT NULL,
  data TEXT NOT NULL,
  PRIMARY KEY (submission_id, item_id, chunk_index)
)`;

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "studio-flue-delete-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function journalPath(): string {
  return join(workspace, "flue.db");
}

function createJournal(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(META_DDL);
  db.exec(STREAMS_DDL);
  db.exec(BATCHES_DDL);
  db.exec(BATCH_CHUNKS_DDL);
  db.exec(FOLD_DDL);
  db.exec(FOLD_CHUNKS_DDL);
  db.exec(ATTACHMENTS_DDL);
  db.exec(ATTACHMENT_CHUNKS_DDL);
  db.exec(SUBMISSIONS_DDL);
  db.exec(SUBMISSION_CHUNKS_DDL);
  db.prepare("INSERT INTO flue_meta (key, value) VALUES ('format_version', '1')").run();
  return db;
}

function addStream(db: DatabaseSync, path: string, agent: string, instanceId: string): void {
  db.prepare(
    "INSERT INTO flue_conversation_streams " +
      "(path, identity_json, next_offset, producer_id, producer_epoch, next_producer_sequence, incarnation) " +
      "VALUES (?, ?, 0, 'fixture', 1, 0, 'incarnation-1')",
  ).run(path, JSON.stringify({ agentName: agent, instanceId }));
}

function addBatch(db: DatabaseSync, path: string, seq: number, submissionId: string | null): void {
  db.prepare(
    "INSERT INTO flue_conversation_stream_batches " +
      "(path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id) " +
      "VALUES (?, ?, 'fixture', 1, ?, '[]', ?, NULL)",
  ).run(path, seq, seq, submissionId);
}

function addSubmission(
  db: DatabaseSync,
  submissionId: string,
  agent: string,
  conversationId: string,
  status: string,
  kind = "direct",
): void {
  db.prepare(
    "INSERT INTO flue_agent_submissions " +
      "(submission_id, session_key, kind, payload, status, accepted_at) " +
      "VALUES (?, ?, ?, ?, ?, 0)",
  ).run(
    submissionId,
    `agent-session:${JSON.stringify([agent, conversationId, "default", "default"])}`,
    kind,
    JSON.stringify({ kind, agent, id: conversationId, payload: { message: "hi" } }),
    status,
  );
}

function count(db: DatabaseSync, table: string): number {
  const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as unknown as {
    n: number;
  };
  return row.n;
}

function countWhere(
  db: DatabaseSync,
  table: string,
  clause: string,
  ...values: string[]
): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${clause}`)
    .get(...values) as unknown as { n: number };
  return row.n;
}

describe("the journal matchers", () => {
  it("matches a stream id exactly, never by prefix", () => {
    expect(streamPathBelongsTo("agents/studio/cnv_abc", "cnv_abc")).toBe(true);
    expect(streamPathBelongsTo("agents/title/cnv_abc", "cnv_abc")).toBe(true);
    expect(streamPathBelongsTo("agents/studio/cnv_abcd", "cnv_abc")).toBe(false);
    expect(streamPathBelongsTo("agents/studio/cnv_ab", "cnv_abc")).toBe(false);
    expect(streamPathBelongsTo("agents/studio/cnv_abc/extra", "cnv_abc")).toBe(false);
    expect(streamPathBelongsTo("other/studio/cnv_abc", "cnv_abc")).toBe(false);
  });

  it("matches a session key on its second element only", () => {
    const key = (agent: string, id: string): string =>
      `agent-session:${JSON.stringify([agent, id, "default", "default"])}`;
    expect(sessionKeyBelongsTo(key("studio", "cnv_abc"), "cnv_abc")).toBe(true);
    expect(sessionKeyBelongsTo(key("title", "cnv_abc"), "cnv_abc")).toBe(true);
    expect(sessionKeyBelongsTo(key("studio", "cnv_abcd"), "cnv_abc")).toBe(false);
    expect(sessionKeyBelongsTo("not a key", "cnv_abc")).toBe(false);
    expect(sessionKeyBelongsTo("agent-session:not json", "cnv_abc")).toBe(false);
    expect(sessionKeyBelongsTo("agent-session:[]", "cnv_abc")).toBe(false);
    expect(sessionKeyBelongsTo(`agent-session:${JSON.stringify(["studio"])}`, "cnv_abc")).toBe(
      false,
    );
  });
});

describe("deleting one conversation from the journal", () => {
  function seedTarget(db: DatabaseSync): void {
    addStream(db, "agents/studio/cnv_target", "studio", "cnv_target");
    addStream(db, "agents/title/cnv_target", "title", "cnv_target");
    addBatch(db, "agents/studio/cnv_target", 0, "sub_t1");
    addBatch(db, "agents/studio/cnv_target", 1, "sub_t1");
    addBatch(db, "agents/title/cnv_target", 0, "sub_t2");
    db.prepare(
      "INSERT INTO flue_conversation_stream_batch_chunks (path, seq, chunk_index, chunk_count, data) VALUES (?, ?, ?, ?, ?)",
    ).run("agents/studio/cnv_target", 0, 0, 2, "first half");
    db.prepare(
      "INSERT INTO flue_conversation_stream_batch_chunks (path, seq, chunk_index, chunk_count, data) VALUES (?, ?, ?, ?, ?)",
    ).run("agents/studio/cnv_target", 0, 1, 2, "second half");
    db.prepare(
      "INSERT INTO flue_conversation_fold_checkpoints (path, head_offset, incarnation, format_version, data, chunk_count) VALUES (?, '4', 'incarnation-1', 1, NULL, 2)",
    ).run("agents/studio/cnv_target");
    db.prepare(
      "INSERT INTO flue_conversation_fold_checkpoint_chunks (path, chunk_index, data) VALUES (?, ?, ?)",
    ).run("agents/studio/cnv_target", 0, "fold half");
    db.prepare(
      "INSERT INTO flue_conversation_fold_checkpoint_chunks (path, chunk_index, data) VALUES (?, ?, ?)",
    ).run("agents/studio/cnv_target", 1, "fold rest");
    db.prepare(
      "INSERT INTO flue_attachments (stream_path, attachment_id, mime_type, byte_size, digest, conversation_id, chunk_count, created_at) VALUES (?, ?, 'text/plain', 3, 'digest-1', ?, 2, 0)",
    ).run("agents/studio/cnv_target", "att_1", "cnv_target");
    db.prepare(
      "INSERT INTO flue_attachments (stream_path, attachment_id, mime_type, byte_size, digest, conversation_id, chunk_count, created_at) VALUES (?, ?, 'text/plain', 3, 'digest-2', ?, 1, 0)",
    ).run("agents/title/cnv_target", "att_2", "cnv_target");
    db.prepare(
      "INSERT INTO flue_attachment_chunks (stream_path, attachment_id, chunk_index, bytes) VALUES (?, ?, ?, ?)",
    ).run("agents/studio/cnv_target", "att_1", 0, Buffer.from("abc"));
    db.prepare(
      "INSERT INTO flue_attachment_chunks (stream_path, attachment_id, chunk_index, bytes) VALUES (?, ?, ?, ?)",
    ).run("agents/studio/cnv_target", "att_1", 1, Buffer.from("def"));
    db.prepare(
      "INSERT INTO flue_attachment_chunks (stream_path, attachment_id, chunk_index, bytes) VALUES (?, ?, ?, ?)",
    ).run("agents/title/cnv_target", "att_2", 0, Buffer.from("ghi"));
    addSubmission(db, "sub_t1", "studio", "cnv_target", "settled");
    addSubmission(db, "sub_t2", "title", "cnv_target", "settled", "dispatch");
    db.prepare(
      "INSERT INTO flue_submission_chunks (submission_id, item_id, chunk_index, chunk_count, data) VALUES (?, ?, ?, ?, ?)",
    ).run("sub_t1", "item_a", 0, 1, "chunk");
    db.prepare(
      "INSERT INTO flue_submission_chunks (submission_id, item_id, chunk_index, chunk_count, data) VALUES (?, ?, ?, ?, ?)",
    ).run("sub_t2", "item_b", 0, 2, "chunk one");
    db.prepare(
      "INSERT INTO flue_submission_chunks (submission_id, item_id, chunk_index, chunk_count, data) VALUES (?, ?, ?, ?, ?)",
    ).run("sub_t2", "item_b", 1, 2, "chunk two");
  }

  function seedOther(db: DatabaseSync): void {
    addStream(db, "agents/studio/cnv_other", "studio", "cnv_other");
    addBatch(db, "agents/studio/cnv_other", 0, "sub_o1");
    addSubmission(db, "sub_o1", "studio", "cnv_other", "settled");
  }

  it("destroys every row keyed to the id, across all eight tables and both agents", () => {
    const path = journalPath();
    const setup = createJournal(path);
    seedTarget(setup);
    seedOther(setup);
    setup.close();

    const result = deleteFlueJournalForConversation(path, "cnv_target");

    expect(result.streamPaths).toEqual([
      "agents/studio/cnv_target",
      "agents/title/cnv_target",
    ]);
    expect([...result.submissionIds].sort()).toEqual(["sub_t1", "sub_t2"]);
    expect(result.counts).toEqual({
      streams: 2,
      batches: 3,
      batchChunks: 2,
      foldCheckpoints: 1,
      foldCheckpointChunks: 2,
      attachments: 2,
      attachmentChunks: 3,
      submissions: 2,
      submissionChunks: 3,
    });

    const check = new DatabaseSync(path, { readOnly: true });
    try {
      expect(count(check, "flue_conversation_streams")).toBe(1);
      expect(count(check, "flue_conversation_stream_batches")).toBe(1);
      expect(count(check, "flue_conversation_stream_batch_chunks")).toBe(0);
      expect(count(check, "flue_conversation_fold_checkpoints")).toBe(0);
      expect(count(check, "flue_conversation_fold_checkpoint_chunks")).toBe(0);
      expect(count(check, "flue_attachments")).toBe(0);
      expect(count(check, "flue_attachment_chunks")).toBe(0);
      expect(count(check, "flue_agent_submissions")).toBe(1);
      expect(count(check, "flue_submission_chunks")).toBe(0);
      // The survivor is the other conversation, whole.
      expect(
        countWhere(check, "flue_conversation_streams", "path = ?", "agents/studio/cnv_other"),
      ).toBe(1);
      expect(
        countWhere(check, "flue_agent_submissions", "submission_id = ?", "sub_o1"),
      ).toBe(1);
    } finally {
      check.close();
    }
  });

  it("leaves a longer id sharing the prefix untouched, in every table", () => {
    const path = journalPath();
    const setup = createJournal(path);
    addStream(setup, "agents/studio/cnv_abc", "studio", "cnv_abc");
    addBatch(setup, "agents/studio/cnv_abc", 0, "sub_short");
    addSubmission(setup, "sub_short", "studio", "cnv_abc", "settled");
    addStream(setup, "agents/studio/cnv_abcd", "studio", "cnv_abcd");
    addStream(setup, "agents/title/cnv_abcd", "title", "cnv_abcd");
    addBatch(setup, "agents/studio/cnv_abcd", 0, "sub_long");
    addBatch(setup, "agents/title/cnv_abcd", 0, "sub_long_title");
    addSubmission(setup, "sub_long", "studio", "cnv_abcd", "settled");
    addSubmission(setup, "sub_long_title", "title", "cnv_abcd", "settled", "dispatch");
    setup.close();

    deleteFlueJournalForConversation(path, "cnv_abc");

    const check = new DatabaseSync(path, { readOnly: true });
    try {
      expect(count(check, "flue_conversation_streams")).toBe(2);
      expect(count(check, "flue_conversation_stream_batches")).toBe(2);
      expect(count(check, "flue_agent_submissions")).toBe(2);
      expect(
        countWhere(check, "flue_conversation_streams", "path = ?", "agents/studio/cnv_abcd"),
      ).toBe(1);
      expect(
        countWhere(check, "flue_conversation_streams", "path = ?", "agents/title/cnv_abcd"),
      ).toBe(1);
      expect(
        countWhere(check, "flue_agent_submissions", "submission_id = ?", "sub_long"),
      ).toBe(1);
      expect(
        countWhere(
          check,
          "flue_agent_submissions",
          "submission_id = ?",
          "sub_long_title",
        ),
      ).toBe(1);
    } finally {
      check.close();
    }
  });

  it("refuses a conversation with a turn in flight and destroys nothing", () => {
    const path = journalPath();
    const setup = createJournal(path);
    seedTarget(setup);
    addSubmission(setup, "sub_live", "studio", "cnv_target", "running");
    setup.close();

    expect(hasActiveFlueSubmissions(path, "cnv_target")).toBe(true);
    expect(hasActiveFlueSubmissions(path, "cnv_other")).toBe(false);

    try {
      deleteFlueJournalForConversation(path, "cnv_target");
      expect.unreachable("a turn in flight must refuse deletion");
    } catch (error) {
      expect(error).toBeInstanceOf(StorageError);
      if (error instanceof StorageError) {
        expect(error.kind).toBe("conflict");
        expect(error.code).toBe("storage.conflict");
      } else {
        throw error;
      }
    }

    const check = new DatabaseSync(path, { readOnly: true });
    try {
      // The rollback left every row in place: the transcript, the live
      // submission, and the settled ones beside it.
      expect(count(check, "flue_conversation_streams")).toBe(2);
      expect(count(check, "flue_conversation_stream_batches")).toBe(3);
      expect(count(check, "flue_agent_submissions")).toBe(3);
      expect(
        countWhere(check, "flue_agent_submissions", "submission_id = ?", "sub_live"),
      ).toBe(1);
    } finally {
      check.close();
    }
  });

  it("is fail-closed on a submission status it has never seen", () => {
    const path = journalPath();
    const setup = createJournal(path);
    addStream(setup, "agents/studio/cnv_new", "studio", "cnv_new");
    addSubmission(setup, "sub_future", "studio", "cnv_new", "migrating");
    setup.close();

    expect(() => deleteFlueJournalForConversation(path, "cnv_new")).toThrow(StorageError);
  });

  it("treats a missing journal as success with zero counts", () => {
    const result = deleteFlueJournalForConversation(join(workspace, "absent.db"), "cnv_x");
    expect(result.counts).toEqual({
      streams: 0,
      batches: 0,
      batchChunks: 0,
      foldCheckpoints: 0,
      foldCheckpointChunks: 0,
      attachments: 0,
      attachmentChunks: 0,
      submissions: 0,
      submissionChunks: 0,
    });
    expect(hasActiveFlueSubmissions(join(workspace, "absent.db"), "cnv_x")).toBe(false);
  });

  it("leaves a submission with an unreadable session key to nobody", () => {
    const path = journalPath();
    const setup = createJournal(path);
    addStream(setup, "agents/studio/cnv_target", "studio", "cnv_target");
    setup.prepare(
      "INSERT INTO flue_agent_submissions " +
        "(submission_id, session_key, kind, payload, status, accepted_at) " +
        "VALUES ('sub_odd', 'garbage', 'direct', '{}', 'settled', 0)",
    ).run();
    setup.close();

    const result = deleteFlueJournalForConversation(path, "cnv_target");
    expect(result.submissionIds).toEqual([]);

    const check = new DatabaseSync(path, { readOnly: true });
    try {
      expect(
        countWhere(check, "flue_agent_submissions", "submission_id = ?", "sub_odd"),
      ).toBe(1);
    } finally {
      check.close();
    }
  });

  it("refuses an id that cannot name a conversation", () => {
    const path = journalPath();
    createJournal(path).close();
    expect(() => deleteFlueJournalForConversation(path, "")).toThrow(StorageError);
    expect(() => deleteFlueJournalForConversation(path, "agents/studio/x")).toThrow(
      StorageError,
    );
  });
});

describe("deleting while the runtime is live", () => {
  it("deletes through Flue's own open adapter without losing another turn's rows", async () => {
    const { sqlite } = await import("@flue/runtime/node");
    const path = journalPath();
    const setup = createJournal(path);
    addStream(setup, "agents/studio/cnv_target", "studio", "cnv_target");
    addBatch(setup, "agents/studio/cnv_target", 0, "sub_t1");
    addSubmission(setup, "sub_t1", "studio", "cnv_target", "settled");
    addStream(setup, "agents/studio/cnv_other", "studio", "cnv_other");
    addBatch(setup, "agents/studio/cnv_other", 0, "sub_o1");
    addSubmission(setup, "sub_o1", "studio", "cnv_other", "settled");
    setup.close();

    // The harness holds this file open for its whole lifetime through this
    // adapter (`src/db.ts`). Deleting while it is held - rather than only
    // against a closed fixture - is the serialization proof.
    const adapter = sqlite(path);
    if (adapter.migrate !== undefined) await adapter.migrate();
    await adapter.connect();
    try {
      const result = deleteFlueJournalForConversation(path, "cnv_target");
      expect(result.counts.streams).toBe(1);
      expect(result.counts.submissions).toBe(1);

      const check = new DatabaseSync(path, { readOnly: true });
      try {
        expect(
          countWhere(
            check,
            "flue_conversation_streams",
            "path = ?",
            "agents/studio/cnv_target",
          ),
        ).toBe(0);
        expect(
          countWhere(
            check,
            "flue_conversation_streams",
            "path = ?",
            "agents/studio/cnv_other",
          ),
        ).toBe(1);
        expect(
          countWhere(check, "flue_agent_submissions", "submission_id = ?", "sub_o1"),
        ).toBe(1);
        const integrity = check.prepare("PRAGMA integrity_check").get() as unknown as {
          integrity_check: string;
        };
        expect(integrity.integrity_check).toBe("ok");
      } finally {
        check.close();
      }
    } finally {
      if (adapter.close !== undefined) await adapter.close();
    }
  });

  it("surfaces a colliding writer as retryable instead of corrupting", () => {
    const path = journalPath();
    const setup = createJournal(path);
    addStream(setup, "agents/studio/cnv_target", "studio", "cnv_target");
    addSubmission(setup, "sub_t1", "studio", "cnv_target", "settled");
    setup.close();
    // A second connection holding RESERVED the way a Flue write transaction
    // does while our delete waits on it.
    const holder = new DatabaseSync(path);
    holder.exec("BEGIN IMMEDIATE");
    try {
      deleteFlueJournalForConversation(path, "cnv_target");
      expect.unreachable("a colliding writer must surface as retryable");
    } catch (error) {
      // Five seconds of busy wait, then a retryable refusal - never a
      // partial delete and never a corrupt file.
      expect(error).toBeInstanceOf(StorageError);
      if (error instanceof StorageError) {
        expect(error.kind).toBe("unavailable");
      } else {
        throw error;
      }
    } finally {
      holder.exec("ROLLBACK");
      holder.close();
    }

    const check = new DatabaseSync(path, { readOnly: true });
    try {
      expect(count(check, "flue_conversation_streams")).toBe(1);
      expect(count(check, "flue_agent_submissions")).toBe(1);
    } finally {
      check.close();
    }
  });
});
