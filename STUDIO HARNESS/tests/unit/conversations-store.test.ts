import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConversationStore } from "../../src/conversations/store.js";
import { deriveTitle } from "../../src/conversations/title.js";
import { purgeConversations } from "../../src/conversations/purge.js";
import { ExtensionSelectionStore } from "../../src/extend/selection.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PlanItemStore } from "../../src/plan/plan-items.js";
import { PendingQuestionStore } from "../../src/questions/pending-questions.js";
import { ProjectStore } from "../../src/projects/store.js";
import {
  conversationWorkspaceDirectory,
  ensureDirectory,
} from "../../src/platform/paths.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { StorageError } from "../../src/storage/errors.js";

let db: StudioDatabase;
const opened: StudioDatabase[] = [];
let previousHome: string | undefined;
let workspace: string;

beforeEach(() => {
  previousHome = process.env.PROJECT_STUDIO_HOME;
  workspace = mkdtempSync(join(tmpdir(), "studio-conversations-"));
  process.env.PROJECT_STUDIO_HOME = workspace;
  db = openDatabase({ path: ":memory:" });
  opened.push(db);
});

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.close();
  }
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  rmSync(workspace, { recursive: true, force: true });
});

describe("the conversation index", () => {
  it("records an admitted first turn once", () => {
    const store = new ConversationStore(db);
    const record = store.record({
      id: "cnv_1",
      firstMessage: "What measure should the transcript use?",
    });

    // Verbatim from the rule the webview applied before it moved here,
    // including its quirk of stripping `.,;:` and leaving a question mark.
    expect(record.title).toBe("What measure should the transcript use?");
    expect(record.pinned).toBe(false);
    expect(record.archived).toBe(false);
    expect(store.count()).toBe(1);
  });

  it("derives no second transcript row: the record carries identity only", () => {
    // The schema's whole point. If a message ever lands in this table, Flue
    // has two transcripts.
    const columns = (
      db.prepare("PRAGMA table_info(conversation)").all() as unknown as {
        name: string;
      }[]
    ).map((column) => column.name);

    expect(columns).not.toContain("message");
    expect(columns).not.toContain("messages");
    expect(columns).not.toContain("record_json");
  });

  it("treats a repeat of the same admission as a touch, not a duplicate", () => {
    const store = new ConversationStore(db);
    store.record({ id: "cnv_1", firstMessage: "First words" });
    const again = store.record({
      id: "cnv_1",
      firstMessage: "Completely different later words",
    });

    expect(again.createdAt).toBeGreaterThan(0);
    expect(store.get("cnv_1")?.title).toBe("First words");
    expect(store.count()).toBe(1);
  });

  it("stops deriving a title forever once a person renames", () => {
    const store = new ConversationStore(db);
    store.record({ id: "cnv_1", firstMessage: "Auto name" });
    store.patch("cnv_1", { title: "The real name" });

    const renamed = store.get("cnv_1");
    expect(renamed?.titleManual).toBe(true);

    // A repeated admission arrives after a rename and changes none of it:
    // recency moves, words do not.
    const touched = store.record({ id: "cnv_1", firstMessage: "Newer words entirely" });
    expect(touched.title).toBe("The real name");
    expect(touched.titleManual).toBe(true);
  });

  it("files into a project that exists and refuses one that does not", () => {
    const conversations = new ConversationStore(db);
    const projects = new ProjectStore(db);
    projects.create({ id: "prj_x", name: "X", icon: "arc" });

    conversations.record({ id: "cnv_1", firstMessage: "Hello there", projectId: "prj_x" });
    expect(conversations.get("cnv_1")?.projectId).toBe("prj_x");

    expect(() =>
      conversations.patch("cnv_1", { projectId: "prj_missing" }),
    ).toThrow(StorageError);
  });

  it("settles the project a later receipt names onto the admitted row", () => {
    // The admission path creates the row first: a first message from a
    // project page is sent BEFORE the window records the conversation, and
    // the submission wire carries no project. So the row exists with no
    // project by the time `createConversation` arrives naming one, and that
    // receipt is the only statement of which project the conversation
    // belongs to. Dropping it filed every project conversation under none.
    const conversations = new ConversationStore(db);
    const projects = new ProjectStore(db);
    projects.create({ id: "prj_home", name: "Home", icon: "arc" });

    conversations.record({ id: "cnv_p", firstMessage: "Admitted first" });
    expect(conversations.get("cnv_p")?.projectId).toBe(null);

    conversations.record({
      id: "cnv_p",
      firstMessage: "Admitted first",
      projectId: "prj_home",
    });
    expect(conversations.get("cnv_p")?.projectId).toBe("prj_home");
    expect(conversations.list({ projectId: "prj_home" }).map((row) => row.id)).toEqual([
      "cnv_p",
    ]);
  });

  it("leaves a filed conversation alone when a later receipt names no project", () => {
    // A plain repeat receipt must not unfile anything: absent is "nothing to
    // say about the project", not "no project".
    const conversations = new ConversationStore(db);
    const projects = new ProjectStore(db);
    projects.create({ id: "prj_keep", name: "Keep", icon: "arc" });

    conversations.record({ id: "cnv_k", firstMessage: "Filed", projectId: "prj_keep" });
    conversations.record({ id: "cnv_k", firstMessage: "Filed" });
    expect(conversations.get("cnv_k")?.projectId).toBe("prj_keep");
  });

  it("archives without deleting and lists the archive separately", () => {
    const store = new ConversationStore(db);
    store.record({ id: "cnv_a", firstMessage: "One", createdAt: 10 });
    store.record({ id: "cnv_b", firstMessage: "Two", createdAt: 20 });
    store.patch("cnv_b", { archived: true });

    // Newest turn first, archived or not.
    expect(store.list().map((row) => row.id)).toEqual(["cnv_b", "cnv_a"]);
    expect(store.list({ archived: false }).map((row) => row.id)).toEqual(["cnv_a"]);
    expect(store.list({ archived: true }).map((row) => row.id)).toEqual(["cnv_b"]);

    // Restoring is the same flag with the other value; nothing was swept.
    store.patch("cnv_b", { archived: false });
    expect(store.list({ archived: false }).map((row) => row.id)).toHaveLength(2);
  });

  // Recency arrives as a patch, because the webview stamps it from the receipt
  // of a later turn (`ChatPage`) and a patch is the only write it has. It was
  // in the contract and in the client and dropped by the store, so the sidebar
  // re-sorted itself back to first-turn order on every reload.
  it("advances recency through a patch, and never backwards", () => {
    const store = new ConversationStore(db);
    store.record({ id: "cnv_a", firstMessage: "One", createdAt: 10 });
    store.record({ id: "cnv_b", firstMessage: "Two", createdAt: 20 });

    expect(store.patch("cnv_a", { lastTurnAt: 30 }).lastTurnAt).toBe(30);
    expect(store.list().map((row) => row.id)).toEqual(["cnv_a", "cnv_b"]);

    // A late receipt from a slower window must not move it back.
    expect(store.patch("cnv_a", { lastTurnAt: 5 }).lastTurnAt).toBe(30);
  });

  it("lists one project's conversations", () => {
    const projects = new ProjectStore(db);
    const project = projects.create({ name: "X", icon: "arc" });
    const store = new ConversationStore(db);
    store.record({ id: "cnv_in", firstMessage: "Filed", projectId: project.id });
    store.record({ id: "cnv_out", firstMessage: "Loose" });

    expect(store.list({ projectId: project.id }).map((row) => row.id)).toEqual([
      "cnv_in",
    ]);
    // Both filters at once, rather than the last one written winning.
    store.patch("cnv_in", { archived: true });
    expect(store.list({ projectId: project.id, archived: false })).toEqual([]);
  });

  it("refuses to touch or patch what is not there", () => {
    const store = new ConversationStore(db);
    expect(() => store.touch("ghost", Date.now())).toThrow(/No conversation/);
    expect(() => store.patch("ghost", { pinned: true })).toThrow(/No conversation/);
  });

  // The settings a turn was sent with are the row's to remember, so reopening
  // a conversation restores the model it was held with rather than resetting
  // to the default (Task 38). They arrive two ways - creation and patch - and
  // both must land on the same columns.
  describe("the model and reasoning a conversation is held with", () => {
    it("records the settings a first turn was sent with", () => {
      const store = new ConversationStore(db);
      const record = store.record({
        id: "cnv_1",
        firstMessage: "Hello",
        modelId: "openrouter/anthropic/claude-sonnet-4.5",
        reasoningLevel: "high",
      });

      expect(record.modelId).toBe("openrouter/anthropic/claude-sonnet-4.5");
      expect(record.reasoningLevel).toBe("high");
    });

    it("leaves the settings null when creation carries none", () => {
      const store = new ConversationStore(db);
      const record = store.record({ id: "cnv_1", firstMessage: "Hello" });

      expect(record.modelId).toBeNull();
      expect(record.reasoningLevel).toBeNull();
    });

    it("settles and clears the settings through a patch", () => {
      const store = new ConversationStore(db);
      store.record({ id: "cnv_1", firstMessage: "Hello" });

      const settled = store.patch("cnv_1", {
        modelId: "google/gemini-3.5-flash",
        reasoningLevel: "default",
      });
      expect(settled.modelId).toBe("google/gemini-3.5-flash");
      expect(settled.reasoningLevel).toBe("default");

      const cleared = store.patch("cnv_1", { modelId: null, reasoningLevel: null });
      expect(cleared.modelId).toBeNull();
      expect(cleared.reasoningLevel).toBeNull();
    });

    it("converges a repeated receipt that carries settings on one row", () => {
      const store = new ConversationStore(db);
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const again = store.record({
        id: "cnv_1",
        firstMessage: "Words again",
        modelId: "openrouter/anthropic/claude-sonnet-4.5",
        reasoningLevel: "medium",
      });

      expect(store.count()).toBe(1);
      // The receipt does not re-derive the title, and it does not reset a
      // level somebody chose.
      expect(again.title).toBe("First words");
      expect(again.modelId).toBe("openrouter/anthropic/claude-sonnet-4.5");
      expect(again.reasoningLevel).toBe("medium");
    });

    it("reads a stored value the contract does not describe as null", () => {
      const store = new ConversationStore(db);
      store.record({ id: "cnv_1", firstMessage: "Hello", reasoningLevel: "high" });
      db.prepare("UPDATE conversation SET reasoning_level = ? WHERE id = ?").run(
        "utterly-bogus",
        "cnv_1",
      );

      expect(store.get("cnv_1")?.reasoningLevel).toBeNull();
    });
  });

  // The execution mode is the third per-conversation turn setting, and it has
  // one difference from the other two: there is no null. An absent answer IS
  // Manual - a consent nobody recorded is a consent that was not given - so
  // the reader must produce one of the three real modes from every row.
  describe("the permission mode a conversation is held with", () => {
    it("reads an unset row as Manual, and stores nothing a user did not choose", () => {
      const store = new ConversationStore(db);
      store.record({ id: "cnv_1", firstMessage: "Hello" });

      expect(store.get("cnv_1")?.permissionMode).toBe("manual");
      expect(
        (db.prepare("SELECT permission_mode FROM conversation WHERE id = ?").get("cnv_1") as
          { permission_mode: string | null }).permission_mode,
      ).toBeNull();
    });

    it("records the mode a first turn was sent with, and patches it later", () => {
      const store = new ConversationStore(db);
      const created = store.record({
        id: "cnv_1",
        firstMessage: "Hello",
        permissionMode: "auto-edit",
      });
      expect(created.permissionMode).toBe("auto-edit");

      expect(store.patch("cnv_1", { permissionMode: "full-auto" }).permissionMode).toBe(
        "full-auto",
      );
      // Absent leaves the stored answer alone; there is no null to clear to,
      // because Manual is a real answer rather than a clearing of one.
      expect(store.patch("cnv_1", { pinned: true }).permissionMode).toBe("full-auto");
    });

    it("converges a repeated receipt that carries a mode on one row", () => {
      const store = new ConversationStore(db);
      store.record({ id: "cnv_1", firstMessage: "First words" });
      const again = store.record({
        id: "cnv_1",
        firstMessage: "Words again",
        permissionMode: "auto-edit",
      });

      expect(store.count()).toBe(1);
      expect(again.permissionMode).toBe("auto-edit");
    });

    it("reads a stored value that is no longer a mode as Manual", () => {
      const store = new ConversationStore(db);
      store.record({ id: "cnv_1", firstMessage: "Hello", permissionMode: "full-auto" });
      db.prepare("UPDATE conversation SET permission_mode = ? WHERE id = ?").run(
        "utterly-bogus",
        "cnv_1",
      );

      // A corrupted answer must never widen what a run may do, so it reads as
      // the mode that grants nothing.
      expect(store.get("cnv_1")?.permissionMode).toBe("manual");
    });
  });
});

describe("emptying the archive", () => {
  function purgeDependencies(store: ConversationStore): {
    conversations: ConversationStore;
    grants: PermissionGrantStore;
    selection: ExtensionSelectionStore;
    plans: PlanItemStore;
    questions: PendingQuestionStore;
    flueJournalPath: string;
  } {
    // A journal with the required tables and no rows: the purge's journal
    // step succeeds with zero counts, so these tests keep proving what they
    // always proved about rows and trees.
    const flueJournalPath = join(workspace, "flue.db");
    const journal = new DatabaseSync(flueJournalPath);
    try {
      journal.exec(
        "CREATE TABLE flue_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);" +
          "CREATE TABLE flue_conversation_streams (path TEXT PRIMARY KEY, identity_json TEXT NOT NULL, next_offset INTEGER NOT NULL DEFAULT 0);" +
          "CREATE TABLE flue_conversation_stream_batches (path TEXT NOT NULL, seq INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (path, seq));" +
          "CREATE TABLE flue_agent_submissions (submission_id TEXT NOT NULL UNIQUE, session_key TEXT NOT NULL, kind TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL);",
      );
      journal.prepare("INSERT INTO flue_meta (key, value) VALUES ('format_version', '1')").run();
    } finally {
      journal.close();
    }
    return {
      conversations: store,
      grants: new PermissionGrantStore(db),
      selection: new ExtensionSelectionStore(db),
      plans: new PlanItemStore(db),
      questions: new PendingQuestionStore(db),
      flueJournalPath,
    };
  }

  it("destroys rows and each conversation's own tree, over a selection", async () => {
    const store = new ConversationStore(db);
    store.record({ id: "cnv_keep", firstMessage: "Keep", createdAt: 5 });
    for (const id of ["cnv_doomed_1", "cnv_doomed_2"]) {
      store.record({ id, firstMessage: "Doomed", createdAt: 6 });
      const written = join(
        ensureDirectory(conversationWorkspaceDirectory(id)),
        "note.md",
      );
      writeFileSync(written, "a note the model wrote", "utf8");
    }

    const outcome = await purgeConversations(purgeDependencies(store), [
      "cnv_doomed_1",
      "cnv_doomed_2",
    ]);

    expect([...outcome.removed].sort()).toEqual(["cnv_doomed_1", "cnv_doomed_2"]);
    expect(Object.keys(outcome.cleanupFailures)).toEqual([]);
    expect(existsSync(conversationWorkspaceDirectory("cnv_doomed_1"))).toBe(false);
    expect(existsSync(conversationWorkspaceDirectory("cnv_doomed_2"))).toBe(false);
    expect(existsSync(join(workspace, "data", "conversations", "cnv_keep"))).toBe(false);
    expect(store.get("cnv_keep")).toBeDefined();
    expect(store.get("cnv_doomed_1")).toBeUndefined();
  });

  it("absorbs a purge whose tree never existed", async () => {
    const store = new ConversationStore(db);
    store.record({ id: "cnv_empty", firstMessage: "Nothing written yet" });

    const outcome = await purgeConversations(purgeDependencies(store), ["cnv_empty"]);
    expect(outcome.removed).toEqual(["cnv_empty"]);
    expect(Object.keys(outcome.cleanupFailures)).toEqual([]);
  });
});

describe("the title rule, moved here from the webview", () => {
  it("keeps the webview's exact spelling", () => {
    // First sentence, minus the punctuation that only made it a sentence.
    expect(deriveTitle("Short question. And more")).toBe("Short question");
    expect(deriveTitle("one two three four five six seven eight nine ten")).toBe(
      "one two three four five six seven eight",
    );
    expect(deriveTitle("Trailing punctuation, removed.")).toBe(
      "Trailing punctuation, removed",
    );
  });
});
