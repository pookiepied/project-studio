import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../../src/projects/store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { StorageError } from "../../src/storage/errors.js";

let db: StudioDatabase;
const opened: StudioDatabase[] = [];

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  opened.push(db);
});

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.close();
  }
});

describe("projects", () => {
  it("creates with many folders, in order", () => {
    const store = new ProjectStore(db);
    const project = store.create({
      id: "prj_x",
      name: "Quiet Hours",
      icon: "arc",
      description: "The reading and typography work.",
      folders: [
        { name: "quiet-hours", path: "D:/Work/quiet-hours" },
        { name: "design-notes", path: "D:/Work/quiet-hours/design-notes" },
      ],
    });

    expect(project.folders.map((folder) => folder.name)).toEqual([
      "quiet-hours",
      "design-notes",
    ]);
    expect(project.description).toBe("The reading and typography work.");
  });

  it("cannot attach the same folder to one project twice", () => {
    const store = new ProjectStore(db);
    store.create({
      id: "prj_x",
      name: "X",
      icon: "stack",
      folders: [{ name: "a", path: "D:/Work/a" }],
    });

    expect(() =>
      store.addFolder("prj_x", { name: "a again", path: "D:/Work/a" }),
    ).toThrow(StorageError);
  });

  it("shares a folder between projects without sharing its row", () => {
    // Removing the folder from one project must not remove it from the other:
    // independence comes from each project owning its own row.
    const store = new ProjectStore(db);
    store.create({
      id: "prj_a",
      name: "A",
      icon: "arc",
      folders: [{ name: "shared", path: "D:/Work/shared" }],
    });
    store.create({
      id: "prj_b",
      name: "B",
      icon: "ring",
      folders: [{ name: "shared", path: "D:/Work/shared" }],
    });

    const bBefore = store.get("prj_b");
    expect(bBefore?.folders).toHaveLength(1);
    store.removeFolder(bBefore?.folders[0]?.id ?? "");

    expect(store.get("prj_a")?.folders).toHaveLength(1);
    expect(store.get("prj_b")?.folders).toHaveLength(0);
  });

  it("relocates a missing folder instead of dropping it", () => {
    // A recorded folder that is no longer on disk is an ordinary state. The
    // row stays visible until someone points it somewhere real; relocation
    // rewrites the path and keeps the folder's identity.
    const store = new ProjectStore(db);
    store.create({
      id: "prj_x",
      name: "X",
      icon: "wave",
      folders: [{ name: "gone", path: "E:/Old location/gone" }],
    });

    const folderId = store.get("prj_x")?.folders[0]?.id ?? "";
    store.updateFolder(folderId, { path: "F:/New home/gone" });

    const relocated = store.get("prj_x")?.folders[0];
    expect(relocated?.path).toBe("F:/New home/gone");
    expect(relocated?.id).toBe(folderId);
  });

  it("deleting a project detaches conversations rather than destroying them", () => {
    const projects = new ProjectStore(db);
    const conversations = new ConversationStore(db);

    projects.create({
      id: "prj_x",
      name: "X",
      icon: "burst",
      folders: [{ name: "src", path: "D:/Work/x" }],
    });
    conversations.record({
      id: "cnv_1",
      firstMessage: "Filed in X",
      projectId: "prj_x",
    });

    expect(conversations.get("cnv_1")?.projectId).toBe("prj_x");

    // Orphaned by decision, not accident: SET NULL is the same answer
    // removing a project has always meant in the product.
    projects.remove("prj_x");

    expect(projects.get("prj_x")).toBeUndefined();
    expect(conversations.get("cnv_1")?.projectId).toBeNull();
  });

  it("removes folders with their project but keeps other projects' rows", () => {
    const store = new ProjectStore(db);
    store.create({
      id: "prj_a",
      name: "A",
      icon: "grid",
      folders: [{ name: "only-here", path: "D:/Work/only-here" }],
    });
    store.create({ id: "prj_b", name: "B", icon: "diamond" });
    store.addFolder("prj_b", { name: "other", path: "D:/Work/other" });

    store.remove("prj_a");

    expect(store.get("prj_b")?.folders.map((folder) => folder.path)).toEqual([
      "D:/Work/other",
    ]);
  });
});
