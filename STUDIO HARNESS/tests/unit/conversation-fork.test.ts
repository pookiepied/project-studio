import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConversationStore } from "../../src/conversations/store.js";
import {
  forkConversation,
  forkTitle,
  type ForkDependencies,
} from "../../src/conversations/fork.js";
import { ConversationDocumentStore } from "../../src/conversations/documents.js";
import { conversationScope, ExtensionSelectionStore } from "../../src/extend/selection.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PlanItemStore } from "../../src/plan/plan-items.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import { TaskStore } from "../../src/agents/definitions/task-store.js";
import {
  conversationArtifactsDirectory,
  conversationAttachmentsDirectory,
  conversationDirectory,
  conversationScratchDirectory,
  conversationTrashDirectory,
  conversationWorkspaceDirectory,
  ensureDirectory,
} from "../../src/platform/paths.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { StorageError } from "../../src/storage/errors.js";

/**
 * A fork duplicates a conversation under one new id: its index row, its
 * scoped rows and its tree. These tests run under a throwaway
 * `PROJECT_STUDIO_HOME` with a fixture journal - never the user's - and
 * prove the refusal paths leave nothing behind as well as the copy paths.
 */

let db: StudioDatabase;
const opened: StudioDatabase[] = [];
let previousHome: string | undefined;
let workspace: string;

beforeEach(() => {
  previousHome = process.env.PROJECT_STUDIO_HOME;
  workspace = mkdtempSync(join(tmpdir(), "studio-fork-"));
  process.env.PROJECT_STUDIO_HOME = workspace;
  db = openDatabase({ path: ":memory:" });
  opened.push(db);
});

afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  rmSync(workspace, { recursive: true, force: true });
});

function journalFile(): string {
  const path = join(workspace, "flue.db");
  const journal = new DatabaseSync(path);
  try {
    // The live 2.0 table shapes: the journal copy reads the producer and
    // incarnation columns a minimal fixture would omit, so the fixture
    // carries them like the deleter's does.
    journal.exec(
      "CREATE TABLE flue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
        "CREATE TABLE flue_conversation_streams (path TEXT PRIMARY KEY, identity_json TEXT NOT NULL, next_offset INTEGER NOT NULL DEFAULT 0, producer_id TEXT, producer_epoch INTEGER NOT NULL DEFAULT 0, next_producer_sequence INTEGER NOT NULL DEFAULT 0, incarnation TEXT NOT NULL);" +
        "CREATE TABLE flue_conversation_stream_batches (path TEXT NOT NULL, seq INTEGER NOT NULL, producer_id TEXT NOT NULL, producer_epoch INTEGER NOT NULL, producer_sequence INTEGER NOT NULL, data TEXT NOT NULL, submission_id TEXT, attempt_id TEXT, PRIMARY KEY (path, seq), UNIQUE (path, producer_id, producer_epoch, producer_sequence));" +
        "CREATE TABLE flue_conversation_stream_batch_chunks (path TEXT NOT NULL, seq INTEGER NOT NULL, chunk_index INTEGER NOT NULL, chunk_count INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (path, seq, chunk_index));" +
        "CREATE TABLE flue_conversation_fold_checkpoints (path TEXT PRIMARY KEY, head_offset TEXT NOT NULL, incarnation TEXT NOT NULL, format_version INTEGER NOT NULL, data TEXT, chunk_count INTEGER);" +
        "CREATE TABLE flue_attachments (stream_path TEXT NOT NULL, attachment_id TEXT NOT NULL, mime_type TEXT NOT NULL, byte_size INTEGER NOT NULL, digest TEXT NOT NULL, conversation_id TEXT NOT NULL, chunk_count INTEGER NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (stream_path, attachment_id));" +
        "CREATE TABLE flue_attachment_chunks (stream_path TEXT NOT NULL, attachment_id TEXT NOT NULL, chunk_index INTEGER NOT NULL, bytes BLOB NOT NULL, PRIMARY KEY (stream_path, attachment_id, chunk_index));" +
        "CREATE TABLE flue_agent_submissions (sequence INTEGER PRIMARY KEY AUTOINCREMENT, submission_id TEXT NOT NULL UNIQUE, session_key TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, accepted_at INTEGER NOT NULL);",
    );
  } finally {
    journal.close();
  }
  return path;
}

function dependencies(
  store: ConversationStore,
  flueJournalPath: string,
  usage?: { duplicate(sourceId: string, targetId: string): void },
): ForkDependencies {
  return {
    conversations: store,
    grants: new PermissionGrantStore(db),
    selection: new ExtensionSelectionStore(db),
    plans: new PlanItemStore(db),
    folders: new SandboxScopeStore(db),
    documents: new ConversationDocumentStore(db),
    tasks: new TaskStore(db),
    ...(usage === undefined ? {} : { usage }),
    flueJournalPath,
  };
}

function seedSettledSubmission(flueJournalPath: string, conversationId: string): void {
  const journal = new DatabaseSync(flueJournalPath);
  try {
    journal
      .prepare(
        "INSERT INTO flue_agent_submissions (submission_id, session_key, kind, payload, status, accepted_at) VALUES (?, ?, 'direct', '{}', 'settled', 0)",
      )
      .run(
        `sub_${conversationId}`,
        `agent-session:${JSON.stringify(["studio", conversationId, "default", "default"])}`,
      );
  } finally {
    journal.close();
  }
}

function seedLiveSubmission(flueJournalPath: string, conversationId: string): void {
  const journal = new DatabaseSync(flueJournalPath);
  try {
    journal
      .prepare(
        "INSERT INTO flue_agent_submissions (submission_id, session_key, kind, payload, status, accepted_at) VALUES (?, ?, 'direct', '{}', 'running', 0)",
      )
      .run(
        `sub_${conversationId}`,
        `agent-session:${JSON.stringify(["studio", conversationId, "default", "default"])}`,
      );
  } finally {
    journal.close();
  }
}

function seedRunningTask(conversationId: string): void {
  db.prepare(
    `INSERT INTO agent_task
       (id, agent_name, parent_conversation_id, origin_submission_id,
        title, status, created_at)
     VALUES (?, 'general', ?, NULL, 'Still working', 'running', ?)`,
  ).run(`task_${conversationId}`, conversationId, Date.now());
}

function seedJournalTurn(
  flueJournalPath: string,
  conversationId: string,
  submissionId: string,
): void {
  const journal = new DatabaseSync(flueJournalPath);
  try {
    journal
      .prepare(
        "INSERT INTO flue_conversation_streams " +
          "(path, identity_json, next_offset, producer_id, producer_epoch, next_producer_sequence, incarnation) " +
          "VALUES (?, ?, 2, 'fixture', 1, 2, 'incarnation-1')",
      )
      .run(
        `agents/studio/${conversationId}`,
        JSON.stringify({ agentName: "studio", instanceId: conversationId }),
      );
    journal
      .prepare(
        "INSERT INTO flue_conversation_stream_batches " +
          "(path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id) " +
          "VALUES (?, 0, 'fixture', 1, 0, ?, NULL, NULL)",
      )
      .run(`agents/studio/${conversationId}`, JSON.stringify([{ v: 1, id: "record_root" }]));
    journal
      .prepare(
        "INSERT INTO flue_conversation_stream_batches " +
          "(path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id) " +
          "VALUES (?, 1, 'fixture', 1, 1, ?, ?, NULL)",
      )
      .run(
        `agents/studio/${conversationId}`,
        JSON.stringify([{ v: 1, id: "record_turn" }]),
        submissionId,
      );
    journal
      .prepare(
        "INSERT INTO flue_agent_submissions (submission_id, session_key, kind, payload, status, accepted_at) VALUES (?, ?, 'direct', '{}', 'settled', 0)",
      )
      .run(
        submissionId,
        `agent-session:${JSON.stringify(["studio", conversationId, "default", "default"])}`,
      );
  } finally {
    journal.close();
  }
}

function journalBatchData(
  flueJournalPath: string,
  conversationId: string,
): { seq: number; data: string }[] {
  const journal = new DatabaseSync(flueJournalPath, { readOnly: true });
  try {
    return journal
      .prepare(
        "SELECT seq, data FROM flue_conversation_stream_batches WHERE path = ? ORDER BY seq",
      )
      .all(`agents/studio/${conversationId}`) as unknown as {
      seq: number;
      data: string;
    }[];
  } finally {
    journal.close();
  }
}

function seedSource(conversationId: string): void {
  const store = new ConversationStore(db);
  store.record({ id: conversationId, firstMessage: "What eats reeds?" });
  store.patch(conversationId, {
    title: "Reeds",
    modelId: "test/model",
    reasoningLevel: "high",
    permissionMode: "auto",
  });

  const grants = new PermissionGrantStore(db);
  grants.grant(
    { namespace: "native", name: "read_file" },
    {
      clientId: "test",
      sessionId: "test",
      agentId: "studio",
      conversationId,
      projectId: "prj_test",
    },
    "conversation",
  );

  const selection = new ExtensionSelectionStore(db);
  selection.set(
    { kind: "mcp", extensionId: "srv_on", scope: conversationScope(conversationId) },
    true,
  );
  selection.set(
    { kind: "mcp", extensionId: "srv_off", scope: conversationScope(conversationId) },
    false,
  );

  const plans = new PlanItemStore(db);
  plans.merge(
    conversationId,
    [
      { id: "survey", text: "Survey the reeds", status: "done" },
      { id: "write", text: "Write it up", status: "pending" },
    ],
    "person",
  );

  const folders = new SandboxScopeStore(db);
  folders.grant({
    projectId: "",
    conversationId,
    path: join(workspace, "outside"),
    mode: "read",
    source: "question",
  });

  writeFileSync(
    join(ensureDirectory(conversationWorkspaceDirectory(conversationId)), "note.md"),
    "a note the model wrote",
    "utf8",
  );
  writeFileSync(
    join(ensureDirectory(conversationScratchDirectory(conversationId)), "draft.txt"),
    "throwaway",
    "utf8",
  );
  writeFileSync(
    join(ensureDirectory(conversationArtifactsDirectory(conversationId)), "card.json"),
    '{"kind":"card"}',
    "utf8",
  );
  writeFileSync(
    join(ensureDirectory(conversationTrashDirectory(conversationId)), "deleted.md"),
    "already deleted",
    "utf8",
  );
}

function scopedCounts(conversationId: string): {
  grants: number;
  scopes: number;
  plans: number;
  folders: number;
  documents: number;
} {
  const grants = (
    db
      .prepare("SELECT COUNT(*) AS n FROM permission_grant WHERE conversation_id = ?")
      .get(conversationId) as unknown as { n: number }
  ).n;
  const scopes = (
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM extension_scope WHERE scope_kind = 'conversation' AND scope_id = ?",
      )
      .get(conversationId) as unknown as { n: number }
  ).n;
  const plans = (
    db
      .prepare("SELECT COUNT(*) AS n FROM plan_item WHERE conversation_id = ?")
      .get(conversationId) as unknown as { n: number }
  ).n;
  const folders = (
    db
      .prepare("SELECT COUNT(*) AS n FROM sandbox_scope WHERE conversation_id = ?")
      .get(conversationId) as unknown as { n: number }
  ).n;
  const documents = (
    db
      .prepare("SELECT COUNT(*) AS n FROM conversation_document WHERE conversation_id = ?")
      .get(conversationId) as unknown as { n: number }
  ).n;
  return { grants, scopes, plans, folders, documents };
}

describe("forkTitle", () => {
  it("names the fork for its source", () => {
    expect(forkTitle("Reeds")).toBe("Reeds (Fork)");
  });

  it("survives an untitled source", () => {
    expect(forkTitle(null)).toBe("Untitled (Fork)");
    expect(forkTitle("   ")).toBe("Untitled (Fork)");
  });
});

describe("a fork", () => {
  it("duplicates the row, the scoped state and the tree under one new id", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_source");
    seedSettledSubmission(flueJournalPath, "cnv_source");

    const { conversation } = forkConversation(
      dependencies(store, flueJournalPath),
      "cnv_source",
      "cnv_fork",
    );

    expect(conversation.id).toBe("cnv_fork");
    expect(conversation.title).toBe("Reeds (Fork)");
    expect(conversation.titleManual).toBe(true);
    expect(conversation.pinned).toBe(false);
    expect(conversation.archived).toBe(false);
    expect(conversation.projectId).toBeNull();
    expect(conversation.modelId).toBe("test/model");
    expect(conversation.permissionMode).toBe("auto");

    expect(scopedCounts("cnv_fork")).toEqual({
      grants: 1,
      scopes: 2,
      plans: 2,
      folders: 1,
      documents: 0,
    });
    // An explicit off travels like an on: dropping it would switch the
    // fork's extension back on.
    const selection = new ExtensionSelectionStore(db);
    expect(
      selection.decisionAt({
        kind: "mcp",
        extensionId: "srv_off",
        scope: conversationScope("cnv_fork"),
      }),
    ).toBe(false);
    // Positions travel, so the fork's panel reads as the source's did.
    const plans = new PlanItemStore(db);
    expect(plans.list("cnv_fork").items.map((item) => item.id)).toEqual([
      "survey",
      "write",
    ]);

    expect(
      readFileSync(
        join(conversationWorkspaceDirectory("cnv_fork"), "note.md"),
        "utf8",
      ),
    ).toBe("a note the model wrote");
    expect(
      readFileSync(join(conversationScratchDirectory("cnv_fork"), "draft.txt"), "utf8"),
    ).toBe("throwaway");
    expect(
      readFileSync(join(conversationArtifactsDirectory("cnv_fork"), "card.json"), "utf8"),
    ).toBe('{"kind":"card"}');
    // Trash stays behind: it holds files the person already deleted.
    expect(existsSync(conversationTrashDirectory("cnv_fork"))).toBe(false);

    // The source is whole: its row, its scoped rows and its tree are
    // untouched by the fork.
    expect(store.get("cnv_source")?.title).toBe("Reeds");
    expect(scopedCounts("cnv_source")).toEqual({
      grants: 1,
      scopes: 2,
      plans: 2,
      folders: 1,
      documents: 0,
    });
    expect(
      readFileSync(
        join(conversationWorkspaceDirectory("cnv_source"), "note.md"),
        "utf8",
      ),
    ).toBe("a note the model wrote");
  });

  it("duplicates the journal transcript under the new id, running nothing", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_talk");
    seedJournalTurn(flueJournalPath, "cnv_talk", "sub_talk");

    const { conversation, journal } = forkConversation(
      dependencies(store, flueJournalPath),
      "cnv_talk",
      "cnv_echo",
    );

    expect(conversation.id).toBe("cnv_echo");
    expect(journal.streamPaths).toEqual(["agents/studio/cnv_echo"]);
    expect(journal.counts.batches).toBe(2);
    // The transcript travels byte-identical: the fork opens on the
    // source's exact words, and no turn was admitted to write them.
    expect(journalBatchData(flueJournalPath, "cnv_echo")).toEqual(
      journalBatchData(flueJournalPath, "cnv_talk"),
    );
    const check = new DatabaseSync(flueJournalPath, { readOnly: true });
    try {
      const row = check
        .prepare("SELECT identity_json FROM flue_conversation_streams WHERE path = ?")
        .get("agents/studio/cnv_echo") as unknown as { identity_json: string };
      expect(row.identity_json).toBe(
        JSON.stringify({ agentName: "studio", instanceId: "cnv_echo" }),
      );
    } finally {
      check.close();
    }
  });

  it("branches the transcript after the named submission", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_long");
    seedJournalTurn(flueJournalPath, "cnv_long", "sub_first");
    const journal = new DatabaseSync(flueJournalPath);
    try {
      journal
        .prepare(
          "INSERT INTO flue_conversation_stream_batches " +
            "(path, seq, producer_id, producer_epoch, producer_sequence, data, submission_id, attempt_id) " +
            "VALUES (?, 2, 'fixture', 1, 2, ?, ?, NULL)",
        )
        .run(
          "agents/studio/cnv_long",
          JSON.stringify([{ v: 1, id: "record_later" }]),
          "sub_second",
        );
      journal
        .prepare("UPDATE flue_conversation_streams SET next_offset = 3 WHERE path = ?")
        .run("agents/studio/cnv_long");
      journal
        .prepare(
          "INSERT INTO flue_agent_submissions (submission_id, session_key, kind, payload, status, accepted_at) VALUES (?, ?, 'direct', '{}', 'settled', 0)",
        )
        .run(
          "sub_second",
          `agent-session:${JSON.stringify(["studio", "cnv_long", "default", "default"])}`,
        );
    } finally {
      journal.close();
    }

    const { journal: copied } = forkConversation(
      dependencies(store, flueJournalPath),
      "cnv_long",
      "cnv_branch",
      { upToSubmissionId: "sub_first" },
    );

    expect(copied.counts.batches).toBe(2);
    const data = journalBatchData(flueJournalPath, "cnv_branch");
    expect(data.map((batch) => batch.seq)).toEqual([0, 1]);
    expect(JSON.parse(data[1]?.data ?? "[]")).toEqual([{ v: 1, id: "record_turn" }]);
  });

  it("carries the measured context figure to the fork", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_metered");
    seedSettledSubmission(flueJournalPath, "cnv_metered");
    const carried: { sourceId: string; targetId: string }[] = [];

    forkConversation(
      dependencies(store, flueJournalPath, {
        duplicate(sourceId: string, targetId: string): void {
          carried.push({ sourceId, targetId });
        },
      }),
      "cnv_metered",
      "cnv_gauged",
    );

    expect(carried).toEqual([{ sourceId: "cnv_metered", targetId: "cnv_gauged" }]);
  });

  it("carries documents with rewritten paths, unannounced", async () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_docs");
    seedSettledSubmission(flueJournalPath, "cnv_docs");
    const documents = new ConversationDocumentStore(db);
    await documents.add("cnv_docs", {
      fileName: "note.txt",
      mimeType: "text/plain",
      bytes: new TextEncoder().encode("words to read"),
    });
    documents.announce("cnv_docs");

    forkConversation(dependencies(store, flueJournalPath), "cnv_docs", "cnv_copies");

    const copied = documents.list("cnv_copies");
    expect(copied).toHaveLength(1);
    expect(copied[0]?.id).not.toBe(documents.list("cnv_docs")[0]?.id);
    expect(copied[0]?.path).toBe(
      join(conversationAttachmentsDirectory("cnv_copies"), "note.txt"),
    );
    // Cleared, so the fork's next turn announces the documents where they
    // actually are rather than repeating the source's paths.
    expect(copied[0]?.announcedAt).toBeNull();
    expect(existsSync(copied[0]?.path ?? "")).toBe(true);
    expect(conversationDirectory("cnv_docs")).not.toBe(
      conversationDirectory("cnv_copies"),
    );
  });

  it("refuses an unknown source", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    expect(() =>
      forkConversation(dependencies(store, flueJournalPath), "cnv_missing", "cnv_fork"),
    ).toThrowError(StorageError);
    expect(store.get("cnv_fork")).toBeUndefined();
  });

  it("refuses an id that already exists", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_source");
    store.record({ id: "cnv_taken", firstMessage: "Taken" });
    expect(() =>
      forkConversation(dependencies(store, flueJournalPath), "cnv_source", "cnv_taken"),
    ).toThrowError(/already exists/);
    expect(store.get("cnv_taken")?.title).not.toContain("Fork");
  });

  it("refuses a turn in flight and duplicates nothing", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_live");
    seedLiveSubmission(flueJournalPath, "cnv_live");
    expect(() =>
      forkConversation(dependencies(store, flueJournalPath), "cnv_live", "cnv_fork"),
    ).toThrowError(/in flight/);
    expect(store.get("cnv_fork")).toBeUndefined();
    expect(existsSync(conversationDirectory("cnv_fork"))).toBe(false);
    expect(scopedCounts("cnv_fork")).toEqual({
      grants: 0,
      scopes: 0,
      plans: 0,
      folders: 0,
      documents: 0,
    });
  });

  it("refuses a running background task and duplicates nothing", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_busy");
    seedSettledSubmission(flueJournalPath, "cnv_busy");
    seedRunningTask("cnv_busy");
    expect(() =>
      forkConversation(dependencies(store, flueJournalPath), "cnv_busy", "cnv_fork"),
    ).toThrowError(/still running/);
    expect(store.get("cnv_fork")).toBeUndefined();
  });

  it("refuses a traversal id before touching anything", () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    seedSource("cnv_source");
    expect(() =>
      forkConversation(dependencies(store, flueJournalPath), "cnv_source", "../escape"),
    ).toThrowError(StorageError);
    expect(store.get("../escape")).toBeUndefined();
  });
});
