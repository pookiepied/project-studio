import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SnapshotError } from "../../src/snapshots/errors.js";
import { projectKey } from "../../src/snapshots/shadow-repo.js";
import { SnapshotStore } from "../../src/snapshots/store.js";
import { TurnSnapshots } from "../../src/snapshots/turn.js";

/**
 * These run real git against a real temporary project.
 *
 * Mocking git here would test our argument construction and nothing else,
 * which is the part least likely to be wrong. The behaviour worth proving —
 * that `.gitignore` is honoured, that a force-added file survives it, that a
 * restore removes what came after — is entirely git's, mediated by us.
 */

let workspace: string;
let snapshotRoot: string;

function write(relativePath: string, content: string): string {
  const target = join(workspace, relativePath);
  mkdirSync(join(target, ".."), { recursive: true });
  writeFileSync(target, content, "utf8");
  return target;
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "studio-snap-project-"));
  snapshotRoot = mkdtempSync(join(tmpdir(), "studio-snap-store-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
  rmSync(snapshotRoot, { recursive: true, force: true });
});

describe("the shadow repository", () => {
  it("keeps its history outside the project", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write("a.txt", "one");

    await store.capture("turn 1");

    expect(store.location.startsWith(snapshotRoot)).toBe(true);
    expect(existsSync(join(workspace, ".git"))).toBe(false);
  });

  it("gives two projects with the same folder name different histories", () => {
    const first = projectKey("C:\\work\\app");
    const second = projectKey("C:\\other\\app");

    expect(first).not.toBe(second);
    expect(first.startsWith("app-")).toBe(true);
  });
});

describe("what a snapshot contains", () => {
  it("honours .gitignore", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write(".gitignore", "secret.txt\n");
    write("secret.txt", "not ours");
    write("kept.txt", "ours");

    const snapshot = await store.capture("turn 1");
    rmSync(join(workspace, "kept.txt"));
    rmSync(join(workspace, "secret.txt"));

    await store.restore(snapshot.id);

    expect(existsSync(join(workspace, "kept.txt"))).toBe(true);
    // Never recorded, so never restored. That is the point of honouring the
    // ignore file rather than a bug in the restore.
    expect(existsSync(join(workspace, "secret.txt"))).toBe(false);
  });

  it("force-adds an ignored file the agent touched", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write(".gitignore", "build/\n");
    const generated = write("build/out.js", "first");

    // What the gate does: record the path, then snapshot on the next turn.
    store.markTouched(generated);
    const snapshot = await store.capture("turn 2");

    writeFileSync(generated, "second", "utf8");
    await store.restore(snapshot.id);

    expect(readFileSync(generated, "utf8")).toBe("first");
  });
});

describe("restoring", () => {
  it("removes files created after the point being restored", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write("a.txt", "one");
    const snapshot = await store.capture("turn 1");

    write("b.txt", "added later");
    await store.capture("turn 2");

    await store.restore(snapshot.id);

    expect(existsSync(join(workspace, "a.txt"))).toBe(true);
    expect(existsSync(join(workspace, "b.txt"))).toBe(false);
  });

  it("is itself undoable", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write("a.txt", "one");
    const first = await store.capture("turn 1");

    write("a.txt", "two");
    const { undo } = await store.restore(first.id);
    expect(readFileSync(join(workspace, "a.txt"), "utf8")).toBe("one");

    await store.restore(undo.id);
    expect(readFileSync(join(workspace, "a.txt"), "utf8")).toBe("two");
  });

  it("refuses a point that is not in this project's history", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write("a.txt", "one");
    await store.capture("turn 1");

    await expect(store.restore("0".repeat(40))).rejects.toBeInstanceOf(SnapshotError);
  });

  it("lists points newest first", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write("a.txt", "one");
    await store.capture("turn 1");
    await store.capture("turn 2");

    const listed = await store.list();

    expect(listed.map((entry) => entry.label)).toEqual(["turn 2", "turn 1"]);
  });
});

describe("when a snapshot is taken", () => {
  it("takes one snapshot per turn, however many writes there are", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    const turns = new TurnSnapshots({ store });
    write("a.txt", "one");

    await turns.beforeWrite(join(workspace, "a.txt"), "path");
    await turns.beforeWrite(join(workspace, "b.txt"), "path");
    await turns.beforeWrite(join(workspace, "c.txt"), "path");

    expect(await store.list()).toHaveLength(1);
  });

  it("takes nothing for a turn that only reads", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    const turns = new TurnSnapshots({ store });
    write("a.txt", "one");

    turns.beginTurn();
    turns.beginTurn();

    expect(await store.list()).toHaveLength(0);
  });

  it("captures the state before the write, not after", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    const turns = new TurnSnapshots({ store });
    const target = write("a.txt", "before");

    await turns.beforeWrite(target, "path");
    writeFileSync(target, "after", "utf8");

    const [taken] = await store.list();
    await store.restore(taken!.id);
    expect(readFileSync(target, "utf8")).toBe("before");
  });

  it("does not block a write when the history is unavailable", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    // A store pointed at a path that cannot be a git directory.
    Object.defineProperty(store, "capture", {
      value: async () => {
        throw new SnapshotError("unavailable");
      },
    });
    const turns = new TurnSnapshots({ store });

    await expect(turns.beforeWrite(join(workspace, "a.txt"), "path")).resolves.toBeUndefined();
  });

  it("blocks the write when the history is required", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    Object.defineProperty(store, "capture", {
      value: async () => {
        throw new SnapshotError("unavailable");
      },
    });
    const turns = new TurnSnapshots({ store, required: true });

    await expect(
      turns.beforeWrite(join(workspace, "a.txt"), "path"),
    ).rejects.toBeInstanceOf(SnapshotError);
  });

  it("numbers the first turn 1", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    const turns = new TurnSnapshots({ store });
    write("a.txt", "one");

    // Every real caller opens a turn before the turn's first write. Starting
    // the counter at 1 and incrementing first labelled that "turn 2".
    turns.beginTurn();
    await turns.beforeWrite(join(workspace, "a.txt"), "path");
    turns.beginTurn();
    await turns.beforeWrite(join(workspace, "b.txt"), "path");

    expect((await store.list()).map((entry) => entry.label)).toStrictEqual([
      "turn 2",
      "turn 1",
    ]);
  });
});

describe("the repository serialises whole operations", () => {
  it("keeps concurrent captures from folding into one another", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write("a.txt", "one");

    // Eight at once is what the gate admits by default. Before the lock these
    // raced on git's index and some of them failed on `index.lock`.
    const labels = ["one", "two", "three", "four", "five", "six", "seven", "eight"];
    await Promise.all(labels.map((label) => store.capture(label)));

    const taken = await store.list();
    expect(taken).toHaveLength(8);
    // Every label present exactly once: none was lost, none was recorded twice.
    expect([...taken.map((entry) => entry.label)].sort()).toStrictEqual(
      [...labels].sort(),
    );
  });

  it("lets the next capture run after one fails", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    write("a.txt", "one");

    // The chain records completion, not success. A rejected link that stayed
    // in the chain would stop every later capture.
    await expect(store.restore("0000000000000000000000000000000000000000")).rejects.toThrow();
    await expect(store.capture("after the failure")).resolves.toBeDefined();
  });

  it("captures the undo point inside the restore that needs it", async () => {
    const store = new SnapshotStore({ workspaceRoot: workspace, root: snapshotRoot });
    const target = write("a.txt", "first");
    const first = await store.capture("first");

    writeFileSync(target, "second", "utf8");

    // `restore` captures before it restores, and both happen under one lock.
    // A nested lock here would deadlock instead of returning.
    const { undo } = await store.restore(first.id);

    expect(readFileSync(target, "utf8")).toBe("first");
    await store.restore(undo.id);
    expect(readFileSync(target, "utf8")).toBe("second");
  });
});
