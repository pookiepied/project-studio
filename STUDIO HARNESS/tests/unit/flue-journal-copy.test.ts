import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  copyFlueJournalForConversation,
  rewriteStreamIdentity,
} from "../../src/storage/flue-journal-copy.js";
import { StorageError } from "../../src/storage/errors.js";

/**
 * A fork duplicates the transcript in Flue's journal under one new id, and
 * opens on the source's exact words with nothing running.
 *
 * Every test runs against a throwaway journal file holding the live 2.0
 * table shapes (the deleter's fixture DDL) with realistic batch records -
 * a complete turn measured against the user's real `flue.db`, renamed into
 * a fixture namespace - never against the user's data. The live-store tests
 * at the bottom read the copied rows back through Flue's own adapter and
 * fold them through its own history handler, which is the proof the copy is
 * a conversation Flue itself accepts rather than rows that merely look
 * like one.
 */

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
  PRIMARY KEY (stream_path, attachment_id, chunk_index)
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

const CONV = "conv_fixture01";
const SOURCE = "cnv_source";
const TARGET = "cnv_fork";
const SUB1 = "sub_fixture01";
const SUB2 = "sub_fixture02";

function rootRecord(): string {
  return JSON.stringify([
    {
      kind: "root",
      conversationId: CONV,
      harness: "default",
      session: "default",
      affinityKey: "aff_fixture01",
      createdAt: "2026-10-10T05:37:23.369Z",
      uid: "inst_fixture01",
      v: 1,
      id: `record_conversation_created_${CONV}`,
      type: "conversation_created",
      timestamp: "2026-10-10T05:37:23.369Z",
    },
  ]);
}

function userRecord(
  submissionId: string,
  messageId: string,
  text: string,
): string {
  return JSON.stringify([
    {
      v: 1,
      id: `record_direct_input_${submissionId}`,
      type: "user_message",
      conversationId: CONV,
      harness: "default",
      session: "default",
      timestamp: "2026-10-10T05:37:23.452Z",
      submissionId,
      attemptId: `attempt_${submissionId}`,
      operationId: `op_${submissionId}`,
      messageId,
      parentId: null,
      content: [{ type: "text", text }],
    },
  ]);
}

function assistantExchange(submissionId: string, stem: string): string[] {
  const messageId = `entry_${stem}`;
  const shared = {
    v: 1,
    conversationId: CONV,
    harness: "default",
    session: "default",
    submissionId,
    attemptId: `attempt_${submissionId}`,
    operationId: `op_${submissionId}`,
    turnId: `turn_${stem}`,
    messageId,
  };
  return [
    JSON.stringify([
      {
        ...shared,
        id: `record_${stem}_started`,
        type: "assistant_message_started",
        timestamp: "2026-10-10T05:37:25.764Z",
        parentId: `entry_direct_input_${submissionId}`,
        modelInfo: {
          api: "openai-completions",
          provider: "openrouter",
          model: "z-ai/glm-5.3-flash",
        },
      },
    ]),
    JSON.stringify([
      {
        ...shared,
        id: `record_${stem}_text_started`,
        type: "assistant_text_started",
        timestamp: "2026-10-10T05:37:26.342Z",
        blockId: `block_${stem}`,
        blockIndex: 1,
      },
    ]),
    JSON.stringify([
      {
        ...shared,
        id: `record_${stem}_text_completed`,
        type: "assistant_text_completed",
        timestamp: "2026-10-10T05:37:26.486Z",
        blockId: `block_${stem}`,
        deltaCount: 0,
      },
    ]),
    JSON.stringify([
      {
        ...shared,
        id: `record_${stem}_message_completed`,
        type: "assistant_message_completed",
        timestamp: "2026-10-10T05:37:26.488Z",
        stopReason: "stop",
        usage: {
          input: 100,
          output: 20,
          cacheRead: 0,
          cacheWrite: 0,
          reasoning: 0,
          totalTokens: 120,
        },
      },
    ]),
    JSON.stringify([
      {
        ...shared,
        id: `record_direct-submission:${submissionId}:settled`,
        type: "submission_settled",
        timestamp: "2026-10-10T05:37:26.504Z",
        outcome: "completed",
      },
    ]),
  ];
}

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "studio-flue-copy-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function journalPath(): string {
  return join(workspace, "flue.db");
}

function createJournal(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(
    "CREATE TABLE flue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  db.exec(STREAMS_DDL);
  db.exec(BATCHES_DDL);
  db.exec(BATCH_CHUNKS_DDL);
  db.exec(FOLD_DDL);
  db.exec(ATTACHMENTS_DDL);
  db.exec(ATTACHMENT_CHUNKS_DDL);
  db.exec(SUBMISSIONS_DDL);
  db.prepare("INSERT INTO flue_meta (key, value) VALUES ('format_version', '1')").run();
  return db;
}

function addStream(
  db: DatabaseSync,
  path: string,
  agent: string,
  instanceId: string,
  nextOffset: number,
): void {
  db.prepare(
    "INSERT INTO flue_conversation_streams " +
      "(path, identity_json, next_offset, producer_id, producer_epoch, next_producer_sequence, incarnation) " +
      "VALUES (?, ?, ?, 'fixture-producer', 3, 7, 'incarnation-9')",
  ).run(path, JSON.stringify({ agentName: agent, instanceId }), nextOffset);
}

function addBatch(
  db: DatabaseSync,
  path: string,
  seq: number,
  data: string,
  submissionId: string | null,
): void {
  db.prepare(
    "INSERT INTO flue_conversation_stream_batches " +
      "(path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id) " +
      "VALUES (?, ?, 'fixture-producer', 3, ?, ?, ?, NULL)",
  ).run(path, seq, seq, data, submissionId);
}

function addSubmission(
  db: DatabaseSync,
  submissionId: string,
  agent: string,
  conversationId: string,
  status: string,
): void {
  db.prepare(
    "INSERT INTO flue_agent_submissions " +
      "(submission_id, session_key, kind, payload, status, accepted_at) " +
      "VALUES (?, ?, 'direct', '{}', ?, 0)",
  ).run(
    submissionId,
    `agent-session:${JSON.stringify([agent, conversationId, "default", "default"])}`,
    status,
  );
}

/** One complete turn plus the start of a second, across two streams. */
function seedSource(db: DatabaseSync): void {
  addStream(db, `agents/studio/${SOURCE}`, "studio", SOURCE, 8);
  const [started, textStarted, textCompleted, messageCompleted, settled] =
    assistantExchange(SUB1, "first");
  addBatch(db, `agents/studio/${SOURCE}`, 0, rootRecord(), null);
  addBatch(db, `agents/studio/${SOURCE}`, 1, userRecord(SUB1, "entry_direct_input_sub_fixture01", "What eats reeds?"), SUB1);
  addBatch(db, `agents/studio/${SOURCE}`, 2, started!, SUB1);
  addBatch(db, `agents/studio/${SOURCE}`, 3, textStarted!, SUB1);
  addBatch(db, `agents/studio/${SOURCE}`, 4, textCompleted!, SUB1);
  addBatch(db, `agents/studio/${SOURCE}`, 5, messageCompleted!, SUB1);
  addBatch(db, `agents/studio/${SOURCE}`, 6, settled!, SUB1);
  addBatch(db, `agents/studio/${SOURCE}`, 7, userRecord(SUB2, "entry_direct_input_sub_fixture02", "And in the water?"), SUB2);
  addStream(db, `agents/title/${SOURCE}`, "title", SOURCE, 1);
  addBatch(db, `agents/title/${SOURCE}`, 0, rootRecord(), null);
  addSubmission(db, SUB1, "studio", SOURCE, "settled");
  addSubmission(db, SUB2, "studio", SOURCE, "settled");
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

describe("rewriteStreamIdentity", () => {
  it("renames the instance and nothing else", () => {
    expect(
      rewriteStreamIdentity(
        JSON.stringify({ agentName: "studio", instanceId: SOURCE }),
        SOURCE,
        TARGET,
      ),
    ).toBe(JSON.stringify({ agentName: "studio", instanceId: TARGET }));
  });

  it("leaves an identity naming another instance alone", () => {
    const identity = JSON.stringify({ agentName: "studio", instanceId: "cnv_other" });
    expect(rewriteStreamIdentity(identity, SOURCE, TARGET)).toBe(identity);
  });

  it("leaves an unreadable identity alone rather than inventing one", () => {
    expect(rewriteStreamIdentity("not json", SOURCE, TARGET)).toBe("not json");
    expect(rewriteStreamIdentity("null", SOURCE, TARGET)).toBe("null");
  });
});

describe("copying one conversation's journal", () => {
  it("duplicates every stream byte-identical except path and identity", () => {
    const path = journalPath();
    const setup = createJournal(path);
    seedSource(setup);
    // A checkpoint is a cache, rebuilt by replay: it must not travel.
    setup
      .prepare(
        "INSERT INTO flue_conversation_fold_checkpoints (path, head_offset, incarnation, format_version, data, chunk_count) VALUES (?, 'x', 'incarnation-9', 2, 'cached', NULL)",
      )
      .run(`agents/studio/${SOURCE}`);
    // An attachment of the conversation's stream travels with it.
    setup
      .prepare(
        "INSERT INTO flue_attachments (stream_path, attachment_id, mime_type, byte_size, digest, conversation_id, chunk_count, created_at) VALUES (?, 'att_1', 'image/png', 4, 'digest-1', ?, 2, 0)",
      )
      .run(`agents/studio/${SOURCE}`, CONV);
    const png = Buffer.from([137, 80, 78, 71]);
    setup
      .prepare(
        "INSERT INTO flue_attachment_chunks (stream_path, attachment_id, chunk_index, bytes) VALUES (?, 'att_1', 0, ?)",
      )
      .run(`agents/studio/${SOURCE}`, png);
    setup
      .prepare(
        "INSERT INTO flue_attachment_chunks (stream_path, attachment_id, chunk_index, bytes) VALUES (?, 'att_1', 1, ?)",
      )
      .run(`agents/studio/${SOURCE}`, png);
    // Another conversation's rows are not the source's, even nearby.
    addStream(setup, "agents/studio/cnv_other", "studio", "cnv_other", 1);
    addBatch(setup, "agents/studio/cnv_other", 0, rootRecord(), null);
    setup.close();

    const result = copyFlueJournalForConversation(path, SOURCE, TARGET);

    expect(result.conversationId).toBe(TARGET);
    expect([...result.streamPaths].sort()).toEqual([
      `agents/studio/${TARGET}`,
      `agents/title/${TARGET}`,
    ]);
    expect(result.counts).toEqual({
      streams: 2,
      batches: 9,
      batchChunks: 0,
      attachments: 1,
      attachmentChunks: 2,
    });

    const check = new DatabaseSync(path, { readOnly: true });
    try {
      const stream = check
        .prepare("SELECT * FROM flue_conversation_streams WHERE path = ?")
        .get(`agents/studio/${TARGET}`) as unknown as Record<string, unknown>;
      expect(stream["identity_json"]).toBe(
        JSON.stringify({ agentName: "studio", instanceId: TARGET }),
      );
      expect(stream["next_offset"]).toBe(8);
      expect(stream["producer_id"]).toBe("fixture-producer");
      expect(stream["producer_epoch"]).toBe(3);
      expect(stream["incarnation"]).toBe("incarnation-9");

      const sourceData = check
        .prepare("SELECT seq, data FROM flue_conversation_stream_batches WHERE path = ? ORDER BY seq")
        .all(`agents/studio/${SOURCE}`) as unknown as { seq: number; data: string }[];
      const targetData = check
        .prepare("SELECT seq, data FROM flue_conversation_stream_batches WHERE path = ? ORDER BY seq")
        .all(`agents/studio/${TARGET}`) as unknown as { seq: number; data: string }[];
      expect(targetData).toEqual(sourceData);
      // The records still name the source's settled submissions as inert
      // history; nothing was rewritten to invent new ones.
      expect(targetData[1]?.data).toContain(SUB1);

      const chunks = check
        .prepare("SELECT stream_path, attachment_id, chunk_index, bytes FROM flue_attachment_chunks WHERE stream_path = ? ORDER BY chunk_index")
        .all(`agents/studio/${TARGET}`) as unknown as {
        stream_path: string;
        attachment_id: string;
        chunk_index: number;
        bytes: Uint8Array;
      }[];
      expect(chunks).toHaveLength(2);
      expect(Buffer.from(chunks[0]?.bytes ?? []).equals(png)).toBe(true);

      // What pointedly did not travel: checkpoints are rebuilt by replay,
      // and submissions are write-time coordination history never joins.
      expect(
        countWhere(check, "flue_conversation_fold_checkpoints", "path = ?", `agents/studio/${TARGET}`),
      ).toBe(0);
      expect(countWhere(check, "flue_agent_submissions", "1 = 1")).toBe(2);
      // The source and the stranger are untouched.
      expect(
        countWhere(check, "flue_conversation_stream_batches", "path = ?", `agents/studio/${SOURCE}`),
      ).toBe(8);
      expect(
        countWhere(check, "flue_conversation_stream_batches", "path = ?", "agents/studio/cnv_other"),
      ).toBe(1);
    } finally {
      check.close();
    }
  });

  it("carries spilled batches through their chunk rows", () => {
    const path = journalPath();
    const setup = createJournal(path);
    addStream(setup, `agents/studio/${SOURCE}`, "studio", SOURCE, 1);
    addBatch(setup, `agents/studio/${SOURCE}`, 0, rootRecord(), null);
    setup
      .prepare(
        "INSERT INTO flue_conversation_stream_batches (path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id) VALUES (?, 1, 'fixture-producer', 3, 1, ?, ?, NULL)",
      )
      .run(`agents/studio/${SOURCE}`, JSON.stringify({ $flueChunkCount: 2 }), SUB1);
    setup
      .prepare(
        "INSERT INTO flue_conversation_stream_batch_chunks (path, seq, chunk_index, chunk_count, data) VALUES (?, 1, 0, 2, ?)",
      )
      .run(`agents/studio/${SOURCE}`, '[{"v":1,');
    setup
      .prepare(
        "INSERT INTO flue_conversation_stream_batch_chunks (path, seq, chunk_index, chunk_count, data) VALUES (?, 1, 1, 2, ?)",
      )
      .run(`agents/studio/${SOURCE}`, '"spilled"}]');
    addSubmission(setup, SUB1, "studio", SOURCE, "settled");
    setup.close();

    const result = copyFlueJournalForConversation(path, SOURCE, TARGET);
    expect(result.counts.batchChunks).toBe(2);

    const check = new DatabaseSync(path, { readOnly: true });
    try {
      const batch = check
        .prepare("SELECT data FROM flue_conversation_stream_batches WHERE path = ? AND seq = 1")
        .get(`agents/studio/${TARGET}`) as unknown as { data: string };
      expect(batch.data).toBe(JSON.stringify({ $flueChunkCount: 2 }));
      const chunks = check
        .prepare("SELECT data FROM flue_conversation_stream_batch_chunks WHERE path = ? AND seq = 1 ORDER BY chunk_index")
        .all(`agents/studio/${TARGET}`) as unknown as { data: string }[];
      expect(chunks.map((chunk) => chunk.data).join("")).toBe('[{"v":1,"spilled"}]');
    } finally {
      check.close();
    }
  });

  it("branches after the named submission's last batch", () => {
    const path = journalPath();
    const setup = createJournal(path);
    seedSource(setup);
    setup.close();

    const result = copyFlueJournalForConversation(path, SOURCE, TARGET, {
      upToSubmissionId: SUB1,
    });

    // Eight source batches on the studio stream, cut after seq 6; the
    // title stream never carried the submission and goes over whole.
    expect(result.counts.batches).toBe(8);
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      expect(
        countWhere(check, "flue_conversation_stream_batches", "path = ?", `agents/studio/${TARGET}`),
      ).toBe(7);
      expect(
        countWhere(check, "flue_conversation_stream_batches", "path = ?", `agents/title/${TARGET}`),
      ).toBe(1);
      // The cut stream continues from the cut: the next turn appends
      // exactly where the named answer ended.
      const stream = check
        .prepare("SELECT next_offset FROM flue_conversation_streams WHERE path = ?")
        .get(`agents/studio/${TARGET}`) as unknown as { next_offset: number };
      expect(stream.next_offset).toBe(7);
      const title = check
        .prepare("SELECT next_offset FROM flue_conversation_streams WHERE path = ?")
        .get(`agents/title/${TARGET}`) as unknown as { next_offset: number };
      expect(title.next_offset).toBe(1);
      const last = check
        .prepare("SELECT submission_id FROM flue_conversation_stream_batches WHERE path = ? ORDER BY seq DESC LIMIT 1")
        .get(`agents/studio/${TARGET}`) as unknown as { submission_id: string };
      expect(last.submission_id).toBe(SUB1);
    } finally {
      check.close();
    }
  });

  it("refuses a turn in flight and writes nothing", () => {
    const path = journalPath();
    const setup = createJournal(path);
    seedSource(setup);
    addSubmission(setup, "sub_live", "studio", SOURCE, "running");
    setup.close();

    expect(() => copyFlueJournalForConversation(path, SOURCE, TARGET)).toThrowError(
      /in flight/,
    );
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      expect(countWhere(check, "flue_conversation_streams", "path = ?", `agents/studio/${TARGET}`)).toBe(0);
      expect(
        countWhere(check, "flue_conversation_stream_batches", "path = ?", `agents/studio/${TARGET}`),
      ).toBe(0);
    } finally {
      check.close();
    }
  });

  it("refuses a target that already has streams", () => {
    const path = journalPath();
    const setup = createJournal(path);
    seedSource(setup);
    addStream(setup, `agents/studio/${TARGET}`, "studio", TARGET, 1);
    setup.close();

    expect(() => copyFlueJournalForConversation(path, SOURCE, TARGET)).toThrowError(
      /already has journal streams/,
    );
  });

  it("refuses a branch point no stream carried", () => {
    const path = journalPath();
    const setup = createJournal(path);
    seedSource(setup);
    setup.close();

    expect(() =>
      copyFlueJournalForConversation(path, SOURCE, TARGET, {
        upToSubmissionId: "sub_stranger",
      }),
    ).toThrowError(/no turn of conversation/);
    const check = new DatabaseSync(path, { readOnly: true });
    try {
      expect(countWhere(check, "flue_conversation_streams", "path = ?", `agents/studio/${TARGET}`)).toBe(0);
    } finally {
      check.close();
    }
  });

  it("refuses ids that cannot name a conversation, itself included", () => {
    const path = journalPath();
    const setup = createJournal(path);
    seedSource(setup);
    setup.close();

    expect(() => copyFlueJournalForConversation(path, SOURCE, SOURCE)).toThrowError(
      StorageError,
    );
    expect(() => copyFlueJournalForConversation(path, "../escape", TARGET)).toThrowError(
      StorageError,
    );
    expect(() =>
      copyFlueJournalForConversation(path, SOURCE, TARGET, { upToSubmissionId: "  " }),
    ).toThrowError(StorageError);
  });

  it("succeeds with zero counts when the journal file is missing", () => {
    const result = copyFlueJournalForConversation(join(workspace, "absent.db"), SOURCE, TARGET);
    expect(result.streamPaths).toEqual([]);
    expect(result.counts).toEqual({
      streams: 0,
      batches: 0,
      batchChunks: 0,
      attachments: 0,
      attachmentChunks: 0,
    });
  });

  it("succeeds with zero counts when the source never ran", () => {
    const path = journalPath();
    const setup = createJournal(path);
    setup.close();

    const result = copyFlueJournalForConversation(path, SOURCE, TARGET);
    expect(result.streamPaths).toEqual([]);
    expect(result.counts.streams).toBe(0);
  });
});

describe("the copied rows through Flue's own store", () => {
  it("reads back identical batches while the runtime holds the file", async () => {
    const { sqlite } = await import("@flue/runtime/node");
    const path = journalPath();
    const setup = createJournal(path);
    seedSource(setup);
    setup.close();

    // The harness holds this file open for its whole lifetime through this
    // adapter (`src/db.ts`). Copying while it is held - rather than only
    // against a closed fixture - is the serialization proof.
    const adapter = sqlite(path);
    if (adapter.migrate !== undefined) await adapter.migrate();
    const stores = await adapter.connect();
    try {
      const result = copyFlueJournalForConversation(path, SOURCE, TARGET);
      expect(result.counts.streams).toBe(2);

      const source = await stores.conversationStreamStore.read(`agents/studio/${SOURCE}`);
      const copied = await stores.conversationStreamStore.read(`agents/studio/${TARGET}`);
      expect(copied.batches).toEqual(source.batches);
      expect(copied.nextOffset).toBe(source.nextOffset);
      expect(copied.upToDate).toBe(true);

      const meta = await stores.conversationStreamStore.getMeta(`agents/studio/${TARGET}`);
      expect(meta?.identity).toEqual({ agentName: "studio", instanceId: TARGET });
    } finally {
      if (adapter.close !== undefined) await adapter.close();
    }
  });

  it("folds the copied stream into the source's history", async () => {
    const { sqlite } = await import("@flue/runtime/node");
    const { handleAgentConversationRead } = await import("@flue/runtime/internal");
    const path = journalPath();
    const setup = createJournal(path);
    // One complete turn only: the fold under test is the transcript the
    // fork opens on, not the cutoff form the branch tests cover row-level.
    addStream(setup, `agents/studio/${SOURCE}`, "studio", SOURCE, 7);
    const [started, textStarted, textCompleted, messageCompleted, settled] =
      assistantExchange(SUB1, "first");
    addBatch(setup, `agents/studio/${SOURCE}`, 0, rootRecord(), null);
    addBatch(setup, `agents/studio/${SOURCE}`, 1, userRecord(SUB1, "entry_direct_input_sub_fixture01", "What eats reeds?"), SUB1);
    addBatch(setup, `agents/studio/${SOURCE}`, 2, started!, SUB1);
    addBatch(setup, `agents/studio/${SOURCE}`, 3, textStarted!, SUB1);
    addBatch(setup, `agents/studio/${SOURCE}`, 4, textCompleted!, SUB1);
    addBatch(setup, `agents/studio/${SOURCE}`, 5, messageCompleted!, SUB1);
    addBatch(setup, `agents/studio/${SOURCE}`, 6, settled!, SUB1);
    addSubmission(setup, SUB1, "studio", SOURCE, "settled");
    setup.close();

    const adapter = sqlite(path);
    if (adapter.migrate !== undefined) await adapter.migrate();
    const stores = await adapter.connect();
    try {
      copyFlueJournalForConversation(path, SOURCE, TARGET);

      const read = (conversationId: string): Promise<Response> =>
        handleAgentConversationRead({
          store: stores.conversationStreamStore,
          path: `agents/studio/${conversationId}`,
          request: new Request(
            `http://127.0.0.1:1/agents/studio/${conversationId}?view=history`,
          ),
        });
      const [sourceResponse, copiedResponse] = await Promise.all([
        read(SOURCE),
        read(TARGET),
      ]);
      expect(sourceResponse.status).toBe(200);
      expect(copiedResponse.status).toBe(200);
      const sourceBody = (await sourceResponse.json()) as unknown;
      const copiedBody = (await copiedResponse.json()) as unknown;
      // The same fold of the same records: the fork opens on the source's
      // exact words.
      expect(copiedBody).toEqual(sourceBody);
    } finally {
      if (adapter.close !== undefined) await adapter.close();
    }
  });
});
