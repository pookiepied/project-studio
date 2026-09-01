import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConversationStore } from "../../src/conversations/store.js";
import { renderMarkdown } from "../../src/conversations/export-markdown.js";
import {
  runExport,
  type ExportRunResult,
} from "../../src/conversations/export-run.js";
import {
  countConversations,
  EXPORT_FORMAT,
  EXPORT_FORMAT_VERSION,
  groupConversations,
  readSubmissionPayload,
  walkStream,
  type ExportedConversation,
  type ExportedStream,
  type ExportMessage,
} from "../../src/conversations/export-walk.js";
import type { ConversationRecord } from "../../src/contracts/conversations.js";
import {
  openDatabase,
  type StudioDatabase,
} from "../../src/storage/database.js";
import { StorageError } from "../../src/storage/errors.js";
import { openFlueJournal } from "../../src/storage/flue-journal.js";

/**
 * The export is a rescue path for real user history, so its tests run against
 * a real journal file built here - the beta runtime's own table SQL, records
 * shaped like the ones measured on a schema-4 journal - and never against the
 * user's data, which changes under the test runner.
 */

// Verbatim from `@flue/runtime@1.0.0-beta.9`'s conversation-stream-store and
// sql-run-store (dist/conversation-stream-store-Bitz7UoW.mjs,
// dist/sql-run-store-DRLffFXh.mjs, dist/run-store-CYeXjR-d.mjs). If a future
// runtime changes these shapes, this fixture deliberately stops matching the
// real journal and the export tests fail loudly.
const STREAMS_DDL = `
CREATE TABLE IF NOT EXISTS flue_conversation_streams (
  path TEXT PRIMARY KEY,
  identity_json TEXT NOT NULL,
  next_offset INTEGER NOT NULL DEFAULT 0,
  producer_id TEXT,
  producer_epoch INTEGER NOT NULL DEFAULT 0,
  next_producer_sequence INTEGER NOT NULL DEFAULT 0,
  incarnation TEXT NOT NULL
)`;
const BATCHES_DDL = `
CREATE TABLE IF NOT EXISTS flue_conversation_stream_batches (
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
const SUBMISSIONS_DDL = `
CREATE TABLE IF NOT EXISTS flue_agent_submissions (
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
  recovery_requested_at INTEGER,
  abort_requested_at INTEGER,
  started_at INTEGER,
  settled_at INTEGER,
  error TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_retry INTEGER NOT NULL DEFAULT 10,
  timeout_at INTEGER NOT NULL DEFAULT 0,
  owner_id TEXT,
  lease_expires_at INTEGER NOT NULL DEFAULT 0,
  settlement_record_id TEXT,
  settlement_record_json TEXT
)`;
const META_DDL = `
CREATE TABLE IF NOT EXISTS flue_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`;

const T0 = "2026-09-01T00:00:00.000Z";

// --- record builders, shaped like the records measured on a real journal ---

function createdRecord(flueConversationId: string): Record<string, unknown> {
  return {
    kind: "root",
    conversationId: flueConversationId,
    harness: "default",
    session: "default",
    createdAt: T0,
    v: 1,
    id: `record_conversation_created_${flueConversationId}`,
    type: "conversation_created",
    timestamp: T0,
  };
}

function userMessageRecord(
  flueConversationId: string,
  text: string,
  submissionId: string,
  timestamp: string,
): Record<string, unknown> {
  return {
    v: 1,
    id: `record_direct_input_${submissionId}`,
    type: "user_message",
    conversationId: flueConversationId,
    timestamp,
    submissionId,
    messageId: `entry_direct_${submissionId}`,
    parentId: null,
    content: [{ type: "text", text }],
  };
}

function messageStartedRecord(
  flueConversationId: string,
  messageId: string,
  submissionId: string,
  timestamp: string,
): Record<string, unknown> {
  return {
    v: 1,
    id: `record_started_${messageId}`,
    type: "assistant_message_started",
    conversationId: flueConversationId,
    timestamp,
    submissionId,
    messageId,
    parentId: null,
    modelInfo: { api: "project-studio-local", provider: "project-studio", model: "default" },
  };
}

function blockStartedRecord(
  type: string,
  messageId: string,
  blockId: string,
  blockIndex: number,
  timestamp: string,
): Record<string, unknown> {
  return {
    v: 1,
    id: `record_${blockId}_started`,
    type,
    timestamp,
    messageId,
    blockId,
    blockIndex,
  };
}

function deltaRecord(
  type: string,
  messageId: string,
  blockId: string,
  sequence: number,
  delta: string,
): Record<string, unknown> {
  return {
    v: 1,
    id: `record_${blockId}_${sequence}`,
    type,
    timestamp: T0,
    messageId,
    blockId,
    sequence,
    delta,
  };
}

function toolCallRecord(
  messageId: string,
  blockId: string,
  blockIndex: number,
  toolCallId: string,
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  return {
    v: 1,
    id: `record_call_${toolCallId}`,
    type: "assistant_tool_call",
    timestamp: T0,
    messageId,
    blockId,
    blockIndex,
    toolCallId,
    name,
    arguments: args,
  };
}

function toolOutcomeRecord(
  toolCallId: string,
  recordId: string,
  isError: boolean,
  text: string,
): Record<string, unknown> {
  return {
    v: 1,
    id: recordId,
    type: "tool_outcome",
    timestamp: T0,
    toolCallId,
    toolName: "write",
    isError,
    content: [{ type: "text", text }],
  };
}

function messageCompletedRecord(
  messageId: string,
  stopReason: string,
  timestamp: string,
): Record<string, unknown> {
  return {
    v: 1,
    id: `record_completed_${messageId}`,
    type: "assistant_message_completed",
    timestamp,
    messageId,
    stopReason,
    usage: { input: 10, output: 5, totalTokens: 15 },
  };
}

function settledRecord(
  submissionId: string,
  outcome: string,
  errorText: string | null,
): Record<string, unknown> {
  return {
    v: 1,
    id: `record_settled_${submissionId}`,
    type: "submission_settled",
    timestamp: T0,
    submissionId,
    outcome,
    ...(errorText === null ? {} : { error: { name: "FlueError", message: errorText } }),
  };
}

function dispatchInputRecord(
  flueConversationId: string,
  submissionId: string,
  message: string,
): Record<string, unknown> {
  return {
    v: 1,
    id: `record_dispatch_input_${submissionId}`,
    type: "signal",
    conversationId: flueConversationId,
    timestamp: T0,
    submissionId,
    messageId: `entry_dispatch_${submissionId}`,
    parentId: null,
    dispatchId: submissionId,
    signalType: "dispatch_input",
    tagName: "dispatch",
    content: JSON.stringify({ message }),
    attributes: { agent: "title", id: flueConversationId },
  };
}

// --- journal fixture writing ---

let workspace: string;
const opened: StudioDatabase[] = [];

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "studio-export-"));
});

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
  rmSync(workspace, { recursive: true, force: true });
});

function writeJournalFixture(path: string): void {
  const db = new DatabaseSync(path);
  try {
    db.exec(META_DDL);
    db.exec(STREAMS_DDL);
    db.exec(BATCHES_DDL);
    db.exec(SUBMISSIONS_DDL);
    db.prepare("INSERT INTO flue_meta (key, value) VALUES ('schema_version', ?)").run("4");

    const writeBatch = (
      streamPath: string,
      seq: number,
      records: readonly Record<string, unknown>[],
      submissionId: string | null,
    ): void => {
      db.prepare(
        "INSERT INTO flue_conversation_stream_batches " +
          "(path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id) " +
          "VALUES (?, ?, 'fixture-producer', 1, ?, ?, ?, NULL)",
      ).run(streamPath, seq, seq, JSON.stringify(records), submissionId);
    };

    const writeStream = (
      streamPath: string,
      agentName: string,
      instanceId: string,
      nextOffset: number,
    ): void => {
      db.prepare(
        "INSERT INTO flue_conversation_streams " +
          "(path, identity_json, next_offset, producer_id, producer_epoch, next_producer_sequence, incarnation) " +
          "VALUES (?, ?, ?, 'fixture-producer', 1, ?, 'incarnation-1')",
      ).run(
        streamPath,
        JSON.stringify({ agentName, instanceId }),
        nextOffset,
        nextOffset,
      );
    };

    const writeSubmission = (options: {
      submissionId: string;
      kind: string;
      payload: string;
      error: string | null;
    }): void => {
      db.prepare(
        "INSERT INTO flue_agent_submissions " +
          "(submission_id, session_key, kind, payload, status, accepted_at, error) " +
          "VALUES (?, 'default', ?, ?, 'settled', 0, ?)",
      ).run(options.submissionId, options.kind, options.payload, options.error);
    };

    // Stream A: the studio agent of a conversation the index knows.
    const streamA = "agents/studio/cnv_known";
    writeStream(streamA, "studio", "cnv_known", 16);
    writeBatch(streamA, 0, [createdRecord("conv_01FIXTUREA")], null);
    writeBatch(
      streamA,
      1,
      [userMessageRecord("conv_01FIXTUREA", "Hello there", "s1", T0)],
      "s1",
    );
    writeBatch(
      streamA,
      2,
      [messageStartedRecord("conv_01FIXTUREA", "m1", "s1", T0)],
      "s1",
    );
    writeBatch(
      streamA,
      3,
      [blockStartedRecord("assistant_reasoning_started", "m1", "b1", 0, T0)],
      "s1",
    );
    // Two reasoning deltas in one batch, out of sequence order: the walk must
    // rebuild the text by sequence, not by arrival.
    writeBatch(
      streamA,
      4,
      [
        deltaRecord("assistant_reasoning_delta", "m1", "b1", 1, "world"),
        deltaRecord("assistant_reasoning_delta", "m1", "b1", 0, "hello "),
      ],
      "s1",
    );
    writeBatch(
      streamA,
      5,
      [{ ...blockStartedRecord("assistant_reasoning_started", "m1", "b1", 0, T0), type: "assistant_reasoning_completed", id: "record_b1_done" }],
      "s1",
    );
    writeBatch(
      streamA,
      6,
      [blockStartedRecord("assistant_text_started", "m1", "b2", 1, T0)],
      "s1",
    );
    writeBatch(streamA, 7, [deltaRecord("assistant_text_delta", "m1", "b2", 0, "Hi ")], "s1");
    // A record type this export has never heard of rides beside a delta: the
    // walk preserves it, counts it, and does not crash.
    writeBatch(streamA, 8, [
      { v: 1, id: "record_future", type: "flue_future_record", note: "unknown" },
      deltaRecord("assistant_text_delta", "m1", "b2", 1, "there."),
    ], "s1");
    writeBatch(streamA, 9, [blockStartedRecord("assistant_text_completed", "m1", "b2", 1, T0)], "s1");
    writeBatch(
      streamA,
      10,
      [toolCallRecord("m1", "b3", 2, "tc1", "write", { path: "a.txt", content: "hi" })],
      "s1",
    );
    writeBatch(streamA, 11, [toolOutcomeRecord("tc1", "record_outcome_1", false, "wrote a.txt")], "s1");
    writeBatch(streamA, 12, [{ v: 1, id: "record_commit_1", type: "tool_results_committed", outcomeIds: ["record_outcome_1"] }], "s1");
    writeBatch(streamA, 13, [messageCompletedRecord("m1", "stop", T0)], "s1");
    writeBatch(streamA, 14, [settledRecord("s1", "completed", null)], "s1");
    // A system signal: measured to be projected by the runtime as a user-role
    // transcript message, so the walk must materialize it the same way.
    writeBatch(streamA, 15, [{
      v: 1,
      id: "record_submission_aborted_s9",
      type: "signal",
      timestamp: T0,
      submissionId: "s9",
      messageId: "entry_submission_aborted_s9",
      parentId: null,
      signalType: "submission_aborted",
      content: "Submission was aborted.",
    }], "s9");

    // Stream B: the titler for the same conversation.
    const streamB = "agents/title/cnv_known";
    writeStream(streamB, "title", "cnv_known", 8);
    writeBatch(streamB, 0, [createdRecord("conv_01FIXTUREB")], null);
    writeBatch(streamB, 1, [dispatchInputRecord("conv_01FIXTUREB", "sT", "Hello there")], "sT");
    writeBatch(streamB, 2, [messageStartedRecord("conv_01FIXTUREB", "mT", "sT", T0)], "sT");
    writeBatch(streamB, 3, [blockStartedRecord("assistant_text_started", "mT", "bT", 0, T0)], "sT");
    writeBatch(streamB, 4, [deltaRecord("assistant_text_delta", "mT", "bT", 0, "A Title")], "sT");
    writeBatch(streamB, 5, [blockStartedRecord("assistant_text_completed", "mT", "bT", 0, T0)], "sT");
    writeBatch(streamB, 6, [messageCompletedRecord("mT", "stop", T0)], "sT");
    writeBatch(streamB, 7, [settledRecord("sT", "completed", null)], "sT");

    // Stream C: an orphan with a recovered input, an unparseable batch, and a
    // tool result no call ever claimed.
    const streamC = "agents/studio/cnv_orphan";
    writeStream(streamC, "studio", "cnv_orphan", 6);
    writeBatch(streamC, 0, [createdRecord("conv_01FIXTUREC")], null);
    writeBatch(streamC, 1, [userMessageRecord("conv_01FIXTUREC", "before the loss", "s2", T0)], "s2");
    writeBatch(streamC, 2, [settledRecord("s2", "completed", null)], "s2");
    writeBatch(streamC, 3, [settledRecord("s3", "aborted", "Submission was aborted.")], "s3");
    writeBatch(streamC, 4, [toolOutcomeRecord("tc_ghost", "record_outcome_ghost", false, "unclaimed result")], null);
    // A batch whose data is not JSON at all: the walk must keep the raw bytes
    // and carry on.
    db.prepare(
      "INSERT INTO flue_conversation_stream_batches " +
        "(path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id) " +
        "VALUES (?, ?, 'fixture-producer', 1, ?, ?, NULL, NULL)",
    ).run(streamC, 5, 5, "not json {");

    writeSubmission({
      submissionId: "s1",
      kind: "direct",
      payload: JSON.stringify({ kind: "direct", submissionId: "s1", agent: "studio", id: "cnv_known", payload: { message: "Hello there" } }),
      error: null,
    });
    writeSubmission({
      submissionId: "s3",
      kind: "direct",
      payload: JSON.stringify({ kind: "direct", submissionId: "s3", agent: "studio", id: "cnv_orphan", payload: { message: "lost message" }, acceptedAt: "2026-09-01T00:00:03.000Z" }),
      error: "Submission was aborted.",
    });
    writeSubmission({
      submissionId: "sT",
      kind: "dispatch",
      payload: JSON.stringify({ kind: "dispatch", submissionId: "sT", agent: "title", id: "cnv_known", payload: { message: "Hello there" } }),
      error: null,
    });
  } finally {
    db.close();
  }
}

function openFixtureJournal(): ReturnType<typeof openFlueJournal> {
  return openFlueJournal(ensureJournalFixture());
}

function fixtureJournalPath(): string {
  return join(workspace, "flue-fixture.db");
}

/** Each test starts with a fresh directory, so the fixture is written once per test, lazily. */
function ensureJournalFixture(): string {
  const path = fixtureJournalPath();
  if (!existsSync(path)) writeJournalFixture(path);
  return path;
}

function messagesOf(stream: ExportedStream): ExportMessage[] {
  return stream.entries
    .filter((entry): entry is { kind: "message"; message: ExportMessage } => entry.kind === "message")
    .map((entry) => entry.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Reads parsed JSON as an object, or names the failure instead of casting. */
function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`${label} is not a JSON object.`);
  }
  return value;
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} is not a JSON array.`);
  }
  return value;
}

describe("the flue journal reader", () => {
  it("reads the schema version, streams, batches in order, and submissions", () => {
    const path = fixtureJournalPath();
    writeJournalFixture(path);
    const journal = openFlueJournal(path);
    try {
      expect(journal.schemaVersion).toBe("4");
      const streams = journal.listStreams();
      expect(streams.map((stream) => stream.path)).toEqual([
        "agents/studio/cnv_known",
        "agents/studio/cnv_orphan",
        "agents/title/cnv_known",
      ]);
      const batches = journal.readBatches("agents/studio/cnv_known");
      expect(batches.map((batch) => batch.seq)).toEqual([
        0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
      ]);
      expect(journal.listSubmissions().map((row) => row.submissionId).sort())
        .toEqual(["s1", "s3", "sT"]);
    } finally {
      journal.close();
    }
  });

  it("refuses a missing file with a named path", () => {
    expect(() => openFlueJournal(join(workspace, "absent.db"))).toThrow(
      StorageError,
    );
  });

  it("refuses a file that holds no journal", () => {
    const path = join(workspace, "not-a-journal.db");
    const db = new DatabaseSync(path);
    try {
      db.exec("CREATE TABLE other (id INTEGER)");
    } finally {
      db.close();
    }
    expect(() => openFlueJournal(path)).toThrow(/does not hold a Flue journal/);
  });
});

describe("the export walk", () => {
  function walkedStreamA(): ExportedStream {
    const journal = openFixtureJournal();
    try {
      const stream = journal.listStreams().find((row) => row.path === "agents/studio/cnv_known");
      if (stream === undefined) throw new Error("fixture stream missing");
      return walkStream({
        stream,
        batches: journal.readBatches(stream.path),
        submissions: journal.listSubmissions(),
      });
    } finally {
      journal.close();
    }
  }

  it("materializes the transcript with deltas rebuilt by sequence", () => {
    const stream = walkedStreamA();
    const messages = messagesOf(stream);

    expect(messages).toHaveLength(3);
    const [user, assistant, signal] = messages;
    expect(user?.role).toBe("user");
    expect(user?.role === "user" ? user.text : undefined).toBe("Hello there");
    expect(assistant?.role).toBe("assistant");
    if (assistant?.role !== "assistant") return;
    expect(signal?.role === "user" ? signal.via : undefined).toBe("signal");
    expect(signal?.role === "user" ? signal.signalType : undefined).toBe("submission_aborted");
    expect(signal?.role === "user" ? signal.text : undefined).toBe("Submission was aborted.");

    expect(assistant.model).toEqual({
      api: "project-studio-local",
      provider: "project-studio",
      model: "default",
    });
    expect(assistant.stopReason).toBe("stop");
    expect(assistant.blocks).toHaveLength(3);
    const [reasoning, text, call] = assistant.blocks;
    expect(reasoning?.type).toBe("reasoning");
    if (reasoning?.type === "reasoning") {
      // Sequence order, not arrival order: "hello " precedes "world".
      expect(reasoning.text).toBe("hello world");
      expect(reasoning.encrypted).toBe(false);
    }
    expect(text?.type).toBe("text");
    if (text?.type === "text") expect(text.text).toBe("Hi there.");
    expect(call?.type).toBe("tool_call");
    if (call?.type === "tool_call") {
      expect(call.name).toBe("write");
      expect(call.toolCallId).toBe("tc1");
      expect(call.result).toEqual({
        content: [{ type: "text", text: "wrote a.txt" }],
        isError: false,
        committed: true,
      });
    }
  });

  it("keeps the verbatim record stream, including unknown record types", () => {
    const stream = walkedStreamA();
    expect(stream.recordCount).toBe(18);
    expect(stream.records).toHaveLength(18);
    expect(stream.records[0]?.["type"]).toBe("conversation_created");
    expect(stream.recordTypes["flue_future_record"]).toBe(1);
    expect(stream.recordTypes["assistant_text_delta"]).toBe(2);
    expect(stream.losses).toEqual([]);
  });

  it("recovers an input the stream never recorded, placed at its settlement", () => {
    const journal = openFixtureJournal();
    try {
      const streamRow = journal.listStreams().find((row) => row.path === "agents/studio/cnv_orphan");
      if (streamRow === undefined) throw new Error("fixture stream missing");
      const stream = walkStream({
        stream: streamRow,
        batches: journal.readBatches(streamRow.path),
        submissions: journal.listSubmissions(),
      });

      const kinds = stream.entries.map((entry) =>
        entry.kind === "message"
          ? entry.message.role === "user"
            ? `user:${entry.message.text}`
            : "assistant"
          : `event:${entry.event.kind}`,
      );
      // The recovered message sits exactly before its settlement record.
      expect(kinds).toEqual([
        "user:before the loss",
        "user:lost message",
        "event:submission_settled",
      ]);
      const recovered = messagesOf(stream)[1];
      expect(recovered?.role === "user" ? recovered.recoveredFrom : undefined).toBe(
        "flue_agent_submissions",
      );
      expect(recovered?.role === "user" ? recovered.timestamp : undefined).toBe(
        "2026-09-01T00:00:03.000Z",
      );
      expect(
        stream.submissions.find((submission) => submission.submissionId === "s3"),
      ).toMatchObject({ recovered: true, outcome: "aborted" });

      expect(stream.unparsedBatches).toHaveLength(1);
      expect(stream.unparsedBatches[0]?.seq).toBe(5);
      expect(stream.losses.some((loss) => /batch 5 could not be parsed/.test(loss))).toBe(true);
      expect(stream.losses.some((loss) => /tc_ghost/.test(loss))).toBe(true);
    } finally {
      journal.close();
    }
  });

  it("materializes a titler dispatch input as a user message", () => {
    const journal = openFixtureJournal();
    try {
      const streamRow = journal.listStreams().find((row) => row.path === "agents/title/cnv_known");
      if (streamRow === undefined) throw new Error("fixture stream missing");
      const stream = walkStream({
        stream: streamRow,
        batches: journal.readBatches(streamRow.path),
        submissions: journal.listSubmissions(),
      });
      const [dispatch] = messagesOf(stream);
      expect(dispatch?.role === "user" ? dispatch.via : undefined).toBe("dispatch");
      expect(dispatch?.role === "user" ? dispatch.text : undefined).toBe("Hello there");
    } finally {
      journal.close();
    }
  });

  it("reads a submission payload without trusting it", () => {
    expect(readSubmissionPayload(null)).toEqual({
      kind: null, agent: null, conversationId: null, message: null, acceptedAt: null,
    });
    expect(readSubmissionPayload("not json {")).toEqual({
      kind: null, agent: null, conversationId: null, message: null, acceptedAt: null,
    });
    const payload = readSubmissionPayload(
      JSON.stringify({ kind: "direct", agent: "studio", id: "cnv_x", payload: { message: "hi" }, acceptedAt: T0 }),
    );
    expect(payload.message).toBe("hi");
    expect(payload.conversationId).toBe("cnv_x");
  });
});

describe("grouping, provenance, and counts", () => {
  function knownRecord(): ConversationRecord {
    return {
      id: "cnv_known",
      title: "A known conversation",
      projectId: null,
      titleManual: false,
      pinned: false,
      archived: false,
      modelId: null,
      reasoningLevel: null,
      permissionMode: "manual",
      createdAt: 0,
      lastTurnAt: 0,
    };
  }

  function exportAll(
    knownFor: (conversationId: string) => ConversationRecord | null,
  ): ExportedConversation[] {
    const journal = openFixtureJournal();
    try {
      const submissionRows = journal.listSubmissions();
      const streams = journal
        .listStreams()
        .map((stream) =>
          walkStream({
            stream,
            batches: journal.readBatches(stream.path),
            submissions: submissionRows,
          }),
        );
      const known = new Map<string, ConversationRecord>();
      for (const stream of streams) {
        const id = stream.path.split("/").pop() ?? stream.path;
        const record = knownFor(id);
        if (record !== null) known.set(id, record);
      }
      return groupConversations(streams, known);
    } finally {
      journal.close();
    }
  }

  it("groups the titler stream under its conversation and marks orphans", () => {
    const conversations = exportAll((conversationId) =>
      conversationId === "cnv_known" ? knownRecord() : null,
    );
    expect(conversations.map((conversation) => conversation.conversationId)).toEqual([
      "cnv_known",
      "cnv_orphan",
    ]);
    const known = conversations[0];
    expect(known?.knownToStudio).toBe(true);
    expect(known?.studio?.title).toBe("A known conversation");
    expect(known?.streams.map((stream) => stream.agent)).toEqual(["studio", "title"]);
    const orphan = conversations[1];
    expect(orphan?.knownToStudio).toBe(false);
    expect(orphan?.studio).toBeNull();
  });

  it("counts across conversations", () => {
    const counts = countConversations(exportAll(() => null));
    expect(counts).toEqual({
      conversations: 2,
      streams: 3,
      knownConversations: 0,
      orphanedConversations: 2,
      userMessages: 4,
      signalMessages: 1,
      assistantMessages: 2,
      toolCalls: 1,
      toolResults: 1,
      records: 18 + 8 + 5,
      recoveredFromSubmissions: 1,
      unparsedBatches: 1,
    });
  });

  it("joins studio index records onto their streams", () => {
    const db = openDatabase({ path: ":memory:" });
    opened.push(db);
    const store = new ConversationStore(db);
    const record = store.record({ id: "cnv_known", firstMessage: "Hello there" });

    const journal = openFixtureJournal();
    try {
      const submissionRows = journal.listSubmissions();
      const streams = journal
        .listStreams()
        .map((stream) =>
          walkStream({ stream, batches: journal.readBatches(stream.path), submissions: submissionRows }),
        );
      const conversations = groupConversations(
        streams,
        new Map([[record.id, record]]),
      );
      expect(conversations[0]?.knownToStudio).toBe(true);
      expect(conversations[0]?.studio?.title).toBe("Hello there");
      expect(conversations[1]?.knownToStudio).toBe(false);
    } finally {
      journal.close();
    }
  });
});

describe("the export run", () => {
  function writeAndOpen(): { journal: ReturnType<typeof openFlueJournal>; store: ConversationStore; db: StudioDatabase } {
    const db = openDatabase({ path: ":memory:" });
    opened.push(db);
    const store = new ConversationStore(db);
    store.record({ id: "cnv_known", firstMessage: "Hello there" });
    return { journal: openFlueJournal(ensureJournalFixture()), store, db };
  }

  function runWithPolicy(policy: "include" | "exclude" | "split", outputDirectory: string): ExportRunResult {
    const { journal, store } = writeAndOpen();
    try {
      return runExport({
        journal,
        conversations: store.list(),
        outputDirectory,
        orphans: policy,
        exportedAt: new Date("2026-09-01T12:00:00.000Z"),
        runtime: "fixture",
      });
    } finally {
      journal.close();
    }
  }

  it("writes a self-describing JSON envelope and a readable markdown file", () => {
    const output = join(workspace, "export-include");
    const result = runWithPolicy("include", output);

    expect(result.files.map((file) => file.path.split("\\").pop())).toEqual([
      "conversations.json",
      "conversations.md",
    ]);

    const envelope = requireRecord(
      JSON.parse(readFileSync(join(output, "conversations.json"), "utf8")),
      "envelope",
    );
    expect(envelope["format"]).toBe(EXPORT_FORMAT);
    expect(envelope["formatVersion"]).toBe(EXPORT_FORMAT_VERSION);
    expect(envelope["exportedAt"]).toBe("2026-09-01T12:00:00.000Z");
    expect(envelope["orphans"]).toBe("include");
    const source = requireRecord(envelope["source"], "source");
    expect(source["flueSchemaVersion"]).toBe("4");
    expect(source["runtime"]).toBe("fixture");
    expect(source["tables"]).toEqual([
      "flue_conversation_streams",
      "flue_conversation_stream_batches",
      "flue_agent_submissions",
    ]);

    const markdown = readFileSync(join(output, "conversations.md"), "utf8");
    expect(markdown).toContain("# Project Studio conversation export");
    expect(markdown).toContain("Hello there");
    expect(markdown).toContain("**Tool call: write**");
    expect(markdown).toContain("wrote a.txt");
    expect(markdown).toContain("hello world");
    expect(markdown).toContain("Known to Studio: **no**");
    expect(markdown).toContain("recovered from the submission journal");
    expect(markdown).toContain("A Title");
  });

  it("leaves the journal byte-identical", () => {
    const output = join(workspace, "export-readonly");
    const before = statSync(ensureJournalFixture());
    runWithPolicy("include", output);
    const after = statSync(fixtureJournalPath());
    expect(after.size).toBe(before.size);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it("excludes orphans only when the policy says so, and says so", () => {
    const output = join(workspace, "export-exclude");
    const result = runWithPolicy("exclude", output);
    expect(result.counts.orphanedConversations).toBe(0);
    expect(result.counts.conversations).toBe(1);

    const envelope = requireRecord(
      JSON.parse(readFileSync(join(output, "conversations.json"), "utf8")),
      "envelope",
    );
    const conversations = requireArray(envelope["conversations"], "conversations");
    expect(conversations).toHaveLength(1);
    const first = requireRecord(conversations[0], "conversation[0]");
    expect(first["conversationId"]).toBe("cnv_known");
    const notes = requireArray(envelope["notes"], "notes").map(String);
    expect(notes.some((note) => /Excluded by policy: 1 conversation/.test(note))).toBe(true);
  });

  it("splits into a known file and an orphaned file", () => {
    const output = join(workspace, "export-split");
    const result = runWithPolicy("split", output);
    expect(result.files).toHaveLength(4);
    const names = result.files.map((file) => file.path.split("\\").pop()).sort();
    expect(names).toEqual([
      "conversations-known.json",
      "conversations-known.md",
      "conversations-orphaned.json",
      "conversations-orphaned.md",
    ]);
    const orphaned = requireRecord(
      JSON.parse(readFileSync(join(output, "conversations-orphaned.json"), "utf8")),
      "orphaned envelope",
    );
    const orphanedConversations = requireArray(orphaned["conversations"], "orphaned conversations");
    expect(orphanedConversations).toHaveLength(1);
    const orphanedFirst = requireRecord(orphanedConversations[0], "orphaned conversation[0]");
    expect(orphanedFirst["conversationId"]).toBe("cnv_orphan");
  });

  it("never overwrites an existing export", () => {
    const output = join(workspace, "export-twice");
    runWithPolicy("include", output);
    expect(() => runWithPolicy("include", output)).toThrow(/never overwrites/);
  });

  it("never lets a message body pose as the document's own structure", () => {
    // The headings are what a person navigates the export by. A message that
    // pasted a report into the conversation used to emit its own `##` lines at
    // conversation level: on this machine's real history, 40 conversations
    // rendered 89 of them, so the outline advertised conversations that do not
    // exist. Escaped rather than demoted - demotion has no answer for content
    // already six deep, and `\#` still reads as the `#` the person typed.
    const pasted: ExportMessage = {
      role: "user",
      id: null,
      timestamp: null,
      submissionId: null,
      via: "message",
      signalType: null,
      recoveredFrom: null,
      text: "## Not a conversation\n\n### Nor a message\n\n```\n## fenced stays\n```",
    };
    const stream: ExportedStream = {
      path: "agents/studio/cnv_pasted",
      agent: "studio",
      flueConversationId: "conv_01PASTED",
      createdAt: null,
      streamOffset: 1,
      batchCount: 1,
      recordCount: 1,
      recordTypes: {},
      entries: [{ kind: "message", message: pasted }],
      submissions: [],
      losses: [],
      records: [],
      unparsedBatches: [],
    };
    const conversation: ExportedConversation = {
      conversationId: "cnv_pasted",
      knownToStudio: true,
      studio: null,
      streams: [stream],
    };

    const markdown = renderMarkdown({
      conversations: [conversation],
      exportedAt: "2026-09-01T12:00:00.000Z",
      databaseLabel: "fixture",
      flueSchemaVersion: "4",
      runtime: "fixture",
      orphans: "include",
      jsonFileName: "conversations.json",
    });

    const structural = markdown
      .split("\n")
      .filter((line) => /^#{1,6} /.test(line));
    expect(structural.some((line) => line.includes("Not a conversation"))).toBe(false);
    expect(structural.some((line) => line.includes("Nor a message"))).toBe(false);
    expect(markdown).toContain("\\## Not a conversation");
    expect(markdown).toContain("\\### Nor a message");
    // Inside a fence the heading has no structural meaning already, so it is
    // left exactly as the person wrote it.
    expect(markdown).toContain("\n## fenced stays\n");
  });
});
