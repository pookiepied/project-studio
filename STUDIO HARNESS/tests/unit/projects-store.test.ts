import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProjectStore } from "../../src/projects/store.js";
import { ConversationStore } from "../../src/conversations/store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { StorageError } from "../../src/storage/errors.js";

let db: StudioDatabase;
const opened: StudioDatabase[] = [];
let base = "";
const directories: string[] = [];

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  opened.push(db);
  base = mkdtempSync(join(tmpdir(), "studio-projects-"));
  directories.push(base);
});

afterEach(() => {
  while (opened.length > 0) {
    opened.pop()?.close();
  }
  while (directories.length > 0) {
    const directory = directories.pop();
    if (directory !== undefined) rmSync(directory, { recursive: true, force: true });
  }
});

/**
 * A real directory on this machine, which is what a folder path must name.
 *
 * A folder row is what a turn binds sandbox roots from, so the store refuses
 * a path that is not an existing directory; every folder written below is one
 * this test created and removes afterwards.
 */
function folder(name = "project"): string {
  const directory = join(base, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

describe("projects", () => {
  it("creates with many folders, in order", () => {
    const store = new ProjectStore(db);
    const first = folder("quiet-hours");
    const second = folder("design-notes");
    const project = store.create({
      id: "prj_x",
      name: "Quiet Hours",
      icon: "arc",
      description: "The reading and typography work.",
      folders: [
        { name: "quiet-hours", path: first },
        { name: "design-notes", path: second },
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
    const shared = folder("a");
    store.create({
      id: "prj_x",
      name: "X",
      icon: "stack",
      folders: [{ name: "a", path: shared }],
    });

    expect(() =>
      store.addFolder("prj_x", { name: "a again", path: shared }),
    ).toThrow(StorageError);
  });

  it("cannot attach the same folder twice within one create", () => {
    const store = new ProjectStore(db);
    const shared = folder("once");

    expect(() =>
      store.create({
        id: "prj_x",
        name: "X",
        icon: "stack",
        folders: [
          { name: "once", path: shared },
          { name: "twice", path: shared },
        ],
      }),
    ).toThrow(StorageError);
    expect(store.get("prj_x")).toBeUndefined();
  });

  it("shares a folder between projects without sharing its row", () => {
    // Removing the folder from one project must not remove it from the other:
    // independence comes from each project owning its own row.
    const store = new ProjectStore(db);
    const shared = folder("shared");
    store.create({
      id: "prj_a",
      name: "A",
      icon: "arc",
      folders: [{ name: "shared", path: shared }],
    });
    store.create({
      id: "prj_b",
      name: "B",
      icon: "ring",
      folders: [{ name: "shared", path: shared }],
    });

    const bBefore = store.get("prj_b");
    expect(bBefore?.folders).toHaveLength(1);
    store.removeFolder(bBefore?.folders[0]?.id ?? "");

    expect(store.get("prj_a")?.folders).toHaveLength(1);
    expect(store.get("prj_b")?.folders).toHaveLength(0);
  });

  it("keeps a row whose folder left the disk, and relocates it to a real one", () => {
    // A recorded folder that is no longer on disk is an ordinary state. The
    // row stays visible until someone points it somewhere real - and since a
    // turn refuses to run into a missing folder, "somewhere real" means a
    // directory that exists, which the relocation now validates.
    const store = new ProjectStore(db);
    const doomed = folder("gone");
    store.create({
      id: "prj_x",
      name: "X",
      icon: "wave",
      folders: [{ name: "gone", path: doomed }],
    });
    rmSync(doomed, { recursive: true, force: true });
    expect(store.get("prj_x")?.folders[0]?.path).toBe(resolve(doomed));

    const folderId = store.get("prj_x")?.folders[0]?.id ?? "";
    const relocated = folder("new-home");
    store.updateFolder(folderId, { path: relocated });

    const after = store.get("prj_x")?.folders[0];
    expect(after?.path).toBe(resolve(relocated));
    expect(after?.id).toBe(folderId);
  });

  it("deleting a project detaches conversations rather than destroying them", () => {
    const projects = new ProjectStore(db);
    const conversations = new ConversationStore(db);

    projects.create({
      id: "prj_x",
      name: "X",
      icon: "burst",
      folders: [{ name: "src", path: folder("x") }],
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
      folders: [{ name: "only-here", path: folder("only-here") }],
    });
    store.create({ id: "prj_b", name: "B", icon: "diamond" });
    store.addFolder("prj_b", { name: "other", path: folder("other") });

    store.remove("prj_a");

    expect(store.get("prj_b")?.folders.map((entry) => entry.path)).toEqual([
      resolve(folder("other")),
    ]);
  });
});

describe("folder paths are validated on write", () => {
  it("refuses a relative path on create", () => {
    const store = new ProjectStore(db);
    expect(() =>
      store.create({
        id: "prj_rel",
        name: "X",
        icon: "arc",
        folders: [{ name: "relative", path: join("Work", "relative") }],
      }),
    ).toThrow(/not absolute/i);
    expect(store.get("prj_rel")).toBeUndefined();
  });

  it("refuses a path that does not exist", () => {
    const store = new ProjectStore(db);
    const missing = join(base, "never-created");
    expect(() =>
      store.create({
        id: "prj_missing",
        name: "X",
        icon: "arc",
        folders: [{ name: "missing", path: missing }],
      }),
    ).toThrow(/does not exist/);
  });

  it("refuses a path that is a file, not a directory", () => {
    const store = new ProjectStore(db);
    const file = join(base, "a-file.txt");
    writeFileSync(file, "not a directory");
    expect(() =>
      store.create({
        id: "prj_file",
        name: "X",
        icon: "arc",
        folders: [{ name: "file", path: file }],
      }),
    ).toThrow(/not a directory/);
  });

  it("refuses a volume root with a reason that names trusted", () => {
    const store = new ProjectStore(db);
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect(() =>
      store.create({
        id: "prj_root",
        name: "X",
        icon: "arc",
        folders: [{ name: "root", path: root }],
      }),
    ).toThrow(/trusted/i);
  });

  it("refuses a system directory with a reason that names trusted", () => {
    const store = new ProjectStore(db);
    const system =
      process.platform === "win32"
        ? (process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows")
        : "/etc";
    expect(() =>
      store.create({
        id: "prj_system",
        name: "X",
        icon: "arc",
        folders: [{ name: "system", path: system }],
      }),
    ).toThrow(/trusted/i);
  });

  it("refuses an empty path", () => {
    const store = new ProjectStore(db);
    expect(() =>
      store.create({
        id: "prj_empty",
        name: "X",
        icon: "arc",
        folders: [{ name: "empty", path: "   " }],
      }),
    ).toThrow(/required/i);
  });

  it("validates addFolder the same way", () => {
    const store = new ProjectStore(db);
    store.create({ id: "prj_add", name: "X", icon: "arc" });

    expect(() =>
      store.addFolder("prj_add", { name: "missing", path: join(base, "nope") }),
    ).toThrow(StorageError);
    expect(store.get("prj_add")?.folders).toHaveLength(0);

    const added = folder("added");
    store.addFolder("prj_add", { name: "added", path: added });
    expect(store.get("prj_add")?.folders.map((entry) => entry.path)).toEqual([
      resolve(added),
    ]);
  });

  it("validates a relocation the same way", () => {
    const store = new ProjectStore(db);
    store.create({
      id: "prj_move",
      name: "X",
      icon: "arc",
      folders: [{ name: "home", path: folder("home") }],
    });
    const folderId = store.get("prj_move")?.folders[0]?.id ?? "";

    expect(() =>
      store.updateFolder(folderId, { path: join(base, "elsewhere-nowhere") }),
    ).toThrow(StorageError);
  });

  it("stores the normalized absolute form", () => {
    const store = new ProjectStore(db);
    const directory = folder("mixed");
    // The same directory named with forward slashes, which on Windows is a
    // different spelling of one path.
    const spelled = process.platform === "win32" ? directory.replace(/\\/g, "/") : directory;
    store.create({
      id: "prj_norm",
      name: "X",
      icon: "arc",
      folders: [{ name: "mixed", path: spelled }],
    });

    expect(store.get("prj_norm")?.folders[0]?.path).toBe(resolve(directory));
  });

  it("reads rows written before validation as they are, without migrating them", () => {
    // Validation is on write. A project created before it existed may hold a
    // path nothing checked - the row is read as it is, and the turn refusal
    // is what catches it, at the moment it would matter.
    const store = new ProjectStore(db);
    store.create({ id: "prj_old", name: "Old", icon: "arc" });
    db.prepare(
      `INSERT INTO project_folder (id, project_id, path, name, position, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run("fld_old", "prj_old", "E:/From an earlier age/gone", "old", 0, 0);

    expect(store.get("prj_old")?.folders[0]?.path).toBe("E:/From an earlier age/gone");
  });
});
