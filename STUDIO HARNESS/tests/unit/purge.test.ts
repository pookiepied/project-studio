import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConversationStore } from "../../src/conversations/store.js";
import {
  listOrphanConversationTrees,
  purgeConversations,
  sweepOrphanConversationTrees,
  type PurgeDependencies,
} from "../../src/conversations/purge.js";
import { conversationScope, ExtensionSelectionStore } from "../../src/extend/selection.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PlanItemStore } from "../../src/plan/plan-items.js";
import { PendingQuestionStore } from "../../src/questions/pending-questions.js";
import {
  conversationWorkspaceDirectory,
  conversationsDirectory,
  ensureDirectory,
} from "../../src/platform/paths.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * A purge destroys everything a conversation owns, in an order that never
 * strands anything unreachable. These tests run under a throwaway
 * `PROJECT_STUDIO_HOME` with a fixture journal - never the user's - and
 * reproduce the orphan state by removing index rows directly.
 */

let db: StudioDatabase;
const opened: StudioDatabase[] = [];
let previousHome: string | undefined;
let workspace: string;

beforeEach(() => {
  previousHome = process.env.PROJECT_STUDIO_HOME;
  workspace = mkdtempSync(join(tmpdir(), "studio-purge-"));
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
    journal.exec(
      "CREATE TABLE flue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
        "CREATE TABLE flue_conversation_streams (path TEXT PRIMARY KEY, identity_json TEXT NOT NULL, next_offset INTEGER NOT NULL DEFAULT 0);" +
        "CREATE TABLE flue_conversation_stream_batches (path TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (path, seq));" +
        "CREATE TABLE flue_agent_submissions (submission_id TEXT NOT NULL UNIQUE, session_key TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL);",
    );
  } finally {
    journal.close();
  }
  return path;
}

function dependencies(
  store: ConversationStore,
  flueJournalPath: string,
): PurgeDependencies {
  return {
    conversations: store,
    grants: new PermissionGrantStore(db),
    selection: new ExtensionSelectionStore(db),
    plans: new PlanItemStore(db),
    questions: new PendingQuestionStore(db),
    flueJournalPath,
  };
}

function seedJournal(flueJournalPath: string, conversationId: string, status = "settled"): void {
  const journal = new DatabaseSync(flueJournalPath);
  try {
    for (const agent of ["studio", "title"]) {
      const path = `agents/${agent}/${conversationId}`;
      journal
        .prepare(
          "INSERT INTO flue_conversation_streams (path, identity_json, next_offset) VALUES (?, ?, 0)",
        )
        .run(path, JSON.stringify({ agentName: agent, instanceId: conversationId }));
      journal
        .prepare(
          "INSERT INTO flue_conversation_stream_batches (path, seq, data) VALUES (?, 0, '[]')",
        )
        .run(path);
    }
    journal
      .prepare(
        "INSERT INTO flue_agent_submissions (submission_id, session_key, kind, payload, status) VALUES (?, ?, 'direct', '{}', ?)",
      )
      .run(
        `sub_${conversationId}`,
        `agent-session:${JSON.stringify(["studio", conversationId, "default", "default"])}`,
        status,
      );
  } finally {
    journal.close();
  }
}

function journalCounts(
  flueJournalPath: string,
  conversationId: string,
): { streams: number; batches: number; submissions: number } {
  const journal = new DatabaseSync(flueJournalPath, { readOnly: true });
  try {
    const streams = (
      journal.prepare("SELECT path FROM flue_conversation_streams").all() as unknown as {
        path: string;
      }[]
    ).filter((row) => row.path.split("/").pop() === conversationId).length;
    const batches = (
      journal.prepare("SELECT path FROM flue_conversation_stream_batches").all() as unknown as {
        path: string;
      }[]
    ).filter((row) => row.path.split("/").pop() === conversationId).length;
    const submissions = (
      journal.prepare("SELECT session_key FROM flue_agent_submissions").all() as unknown as {
        session_key: string;
      }[]
    ).filter((row) => row.session_key.includes(`"${conversationId}"`)).length;
    return { streams, batches, submissions };
  } finally {
    journal.close();
  }
}

function seedScoped(conversationId: string): void {
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
    { kind: "mcp", extensionId: "srv_test", scope: conversationScope(conversationId) },
    true,
  );
}

function scopedCounts(conversationId: string): { grants: number; scopes: number } {
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
  return { grants, scopes };
}

function seedTree(conversationId: string): void {
  writeFileSync(
    join(ensureDirectory(conversationWorkspaceDirectory(conversationId)), "note.md"),
    "a note the model wrote",
    "utf8",
  );
}

describe("a complete purge", () => {
  it("destroys the journal, the scoped rows, the index row, and the tree", async () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    store.record({ id: "cnv_doomed", firstMessage: "Doomed" });
    store.record({ id: "cnv_keep", firstMessage: "Keep" });
    seedJournal(flueJournalPath, "cnv_doomed");
    seedJournal(flueJournalPath, "cnv_keep");
    seedScoped("cnv_doomed");
    seedScoped("cnv_keep");
    seedTree("cnv_doomed");

    const outcome = await purgeConversations(dependencies(store, flueJournalPath), [
      "cnv_doomed",
    ]);

    expect(outcome.removed).toEqual(["cnv_doomed"]);
    expect(outcome.cleanupFailures).toEqual({});
    expect(outcome.details["cnv_doomed"]).toEqual({
      indexRow: true,
      tree: true,
      journal: true,
      scoped: true,
    });
    expect(store.get("cnv_doomed")).toBeUndefined();
    expect(journalCounts(flueJournalPath, "cnv_doomed")).toEqual({
      streams: 0,
      batches: 0,
      submissions: 0,
    });
    expect(scopedCounts("cnv_doomed")).toEqual({ grants: 0, scopes: 0 });
    expect(existsSync(conversationWorkspaceDirectory("cnv_doomed"))).toBe(false);
    // The other conversation is whole, in both databases.
    expect(store.get("cnv_keep")).toBeDefined();
    expect(journalCounts(flueJournalPath, "cnv_keep")).toEqual({
      streams: 2,
      batches: 2,
      submissions: 1,
    });
    expect(scopedCounts("cnv_keep")).toEqual({ grants: 1, scopes: 1 });
  });

  it("refuses a running conversation and keeps everything it owns", async () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    store.record({ id: "cnv_live", firstMessage: "Live" });
    seedJournal(flueJournalPath, "cnv_live", "running");
    seedScoped("cnv_live");
    seedTree("cnv_live");

    const outcome = await purgeConversations(dependencies(store, flueJournalPath), [
      "cnv_live",
    ]);

    expect(outcome.removed).toEqual([]);
    expect(outcome.cleanupFailures["cnv_live"]).toMatch(/in flight/);
    expect(outcome.details["cnv_live"]).toMatchObject({
      indexRow: false,
      tree: false,
      journal: false,
      scoped: false,
      errorCode: "storage.conflict",
    });
    // Nothing was destroyed: the row, the transcript, the scoped rows, and
    // the tree are all still there for the retry once the turn settles.
    expect(store.get("cnv_live")).toBeDefined();
    expect(journalCounts(flueJournalPath, "cnv_live")).toEqual({
      streams: 2,
      batches: 2,
      submissions: 1,
    });
    expect(scopedCounts("cnv_live")).toEqual({ grants: 1, scopes: 1 });
    expect(existsSync(conversationWorkspaceDirectory("cnv_live"))).toBe(true);
  });

  it("keeps the index row when the journal cannot be reached", async () => {
    const store = new ConversationStore(db);
    store.record({ id: "cnv_stuck", firstMessage: "Stuck" });
    seedTree("cnv_stuck");

    // A directory is not a database: the journal step fails, and the row
    // stays so the delete can be tried again. That ordering is the whole
    // point - a crash between content and row must stay deletable.
    const outcome = await purgeConversations(dependencies(store, workspace), [
      "cnv_stuck",
    ]);

    expect(outcome.removed).toEqual([]);
    expect(outcome.cleanupFailures["cnv_stuck"]).toBeDefined();
    expect(outcome.details["cnv_stuck"]).toMatchObject({
      indexRow: false,
      journal: false,
    });
    expect(store.get("cnv_stuck")).toBeDefined();
    expect(existsSync(conversationWorkspaceDirectory("cnv_stuck"))).toBe(true);
  });

  it("ignores ids no index row addresses", async () => {
    const store = new ConversationStore(db);
    const outcome = await purgeConversations(dependencies(store, journalFile()), [
      "cnv_ghost",
    ]);
    expect(outcome.removed).toEqual([]);
    expect(outcome.cleanupFailures).toEqual({});
    expect(outcome.details["cnv_ghost"]).toBeUndefined();
  });

  it("removes the conversation's plan rows with the rest of it", async () => {
    // The plan is conversation state like the grants: a purge that left it
    // behind would hand the workflow to whatever reads the id next.
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    store.record({ id: "cnv_planned", firstMessage: "Planned" });
    store.record({ id: "cnv_other", firstMessage: "Other" });
    seedJournal(flueJournalPath, "cnv_planned");
    const plans = new PlanItemStore(db);
    plans.merge("cnv_planned", [
      { id: "read-schema", text: "Read the existing schema", status: "done" },
      { id: "write-migration", text: "Write migration 20", status: "running" },
    ], "model");
    plans.merge("cnv_other", [
      { id: "read-schema", text: "Read the existing schema", status: "pending" },
    ], "model");

    const outcome = await purgeConversations(dependencies(store, flueJournalPath), [
      "cnv_planned",
    ]);

    expect(outcome.removed).toEqual(["cnv_planned"]);
    expect(plans.list("cnv_planned").items).toEqual([]);
    expect(plans.list("cnv_other").items).not.toEqual([]);
  });

  it("removes the conversation's questions with the rest of it, settled ones too", async () => {
    // A settled question is kept for the life of the conversation because it
    // is the record of a decision - but a deleted conversation has no
    // decisions to keep, and the question is a sentence the person was shown.
    // The unanswered one matters as much: a card the queue still hands out
    // after its conversation is gone has nowhere to send the answer.
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    store.record({ id: "cnv_asked", firstMessage: "Asked" });
    store.record({ id: "cnv_other", firstMessage: "Other" });
    seedJournal(flueJournalPath, "cnv_asked");
    const questions = new PendingQuestionStore(db);
    const asked = (id: string, conversationId: string, outcome?: "answered"): void => {
      questions.add({
        id,
        conversationId,
        payload: {
          question: "Which database should this use?",
          header: "Storage",
          options: [
            { id: "sqlite", label: "SQLite", description: "One file, no setup." },
            { id: "postgres", label: "Postgres", description: "A server to run." },
          ],
          multiSelect: false,
        },
        askedAt: 1_000,
        expiresAt: null,
        outcome: undefined,
        answer: undefined,
      });
      if (outcome !== undefined) {
        questions.settle(id, outcome, { optionIds: ["sqlite"] });
      }
    };
    asked("q_open", "cnv_asked");
    asked("q_settled", "cnv_asked", "answered");
    asked("q_elsewhere", "cnv_other");

    const outcome = await purgeConversations(dependencies(store, flueJournalPath), [
      "cnv_asked",
    ]);

    expect(outcome.removed).toEqual(["cnv_asked"]);
    expect(questions.get("q_open")).toBeUndefined();
    expect(questions.get("q_settled")).toBeUndefined();
    // Another conversation's question is untouched, answered or not.
    expect(questions.get("q_elsewhere")).toBeDefined();
  });
});

describe("the orphan sweep", () => {
  it("lists and sweeps only trees with no index row and no journal stream", async () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    store.record({ id: "cnv_live", firstMessage: "Live" });
    store.record({ id: "cnv_gone_clean", firstMessage: "Gone" });
    store.record({ id: "cnv_gone_history", firstMessage: "Gone with history" });
    seedTree("cnv_live");
    seedTree("cnv_gone_clean");
    seedTree("cnv_gone_history");
    seedJournal(flueJournalPath, "cnv_gone_history");
    // The shape the user's four orphans are in: the index row removed
    // behind the app's back, the tree left on disk.
    db.prepare("DELETE FROM conversation WHERE id = ?").run("cnv_gone_clean");
    db.prepare("DELETE FROM conversation WHERE id = ?").run("cnv_gone_history");

    const listed = await listOrphanConversationTrees(store, flueJournalPath);
    expect(listed.orphans).toEqual(["cnv_gone_clean"]);

    const swept = await sweepOrphanConversationTrees(store, flueJournalPath);
    expect(swept.removed).toEqual(["cnv_gone_clean"]);
    expect(swept.failures).toEqual({});
    expect(existsSync(join(conversationsDirectory(), "cnv_gone_clean"))).toBe(false);
    expect(existsSync(join(conversationsDirectory(), "cnv_gone_history"))).toBe(true);
    expect(existsSync(join(conversationsDirectory(), "cnv_live"))).toBe(true);
  });

  it("finds nothing when the conversations directory does not exist", async () => {
    const store = new ConversationStore(db);
    const flueJournalPath = journalFile();
    const listed = await listOrphanConversationTrees(store, flueJournalPath);
    expect(listed.orphans).toEqual([]);
    const swept = await sweepOrphanConversationTrees(store, flueJournalPath);
    expect(swept.removed).toEqual([]);
  });
});
