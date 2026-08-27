import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ConversationStore } from "../../src/conversations/store.js";
import { deriveTitle } from "../../src/conversations/title.js";
import { purgeConversations } from "../../src/conversations/purge.js";
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
});

describe("emptying the archive", () => {
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

    const outcome = await purgeConversations(store, ["cnv_doomed_1", "cnv_doomed_2"]);

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

    const outcome = await purgeConversations(store, ["cnv_empty"]);
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
