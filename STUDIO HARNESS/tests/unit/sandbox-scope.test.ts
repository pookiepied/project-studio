import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { environmentBlock } from "../../src/context/environment.js";
import { ProjectStore } from "../../src/projects/store.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy, gitConfigRoots } from "../../src/sandbox/policy.js";
import { systemScopeRefusal, validateCustomScopePath } from "../../src/sandbox/scope.js";
import { SandboxScopeStore } from "../../src/sandbox/scope-store.js";
import {
  applyScopeAnswer,
  buildScopeQuestion,
  ScopeDeclines,
  SCOPE_QUESTION_OPTIONS,
} from "../../src/sandbox/scope-questions.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { StorageError } from "../../src/storage/errors.js";

let db: StudioDatabase;
const opened: StudioDatabase[] = [];
let base = "";
const directories: string[] = [];

function open(): StudioDatabase {
  const handle = openDatabase({ path: ":memory:" });
  opened.push(handle);
  return handle;
}

beforeEach(() => {
  db = open();
  base = mkdtempSync(join(tmpdir(), "studio-scope-"));
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

function workspace(name = "workspace"): string {
  const directory = join(base, name);
  mkdirSync(directory, { recursive: true });
  return directory;
}

describe("migration 21", () => {
  it("creates the scope table and the level column", () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sandbox_scope'")
      .get();
    expect(tables).toBeDefined();

    const columns = db.prepare("PRAGMA table_info(project)").all() as unknown as {
      name: string;
    }[];
    expect(columns.map((column) => column.name)).toContain("sandbox_level");
  });

  it("defaults an untouched project to contained", () => {
    const projects = new ProjectStore(db);
    const project = projects.create({ id: "prj_scope", name: "Scope", icon: "arc" });
    expect(project.sandboxLevel).toBe("contained");
    expect(projects.sandboxLevelOf("prj_scope")).toBe("contained");
  });

  it("stores and reads the trusted level", () => {
    const projects = new ProjectStore(db);
    projects.create({ id: "prj_trusted", name: "Trusted", icon: "arc" });
    projects.setSandboxLevel("prj_trusted", "trusted");
    expect(projects.sandboxLevelOf("prj_trusted")).toBe("trusted");
    expect(projects.get("prj_trusted")?.sandboxLevel).toBe("trusted");
  });
});

describe("the scope store", () => {
  it("grants and lists a project row with its source", () => {
    const scopes = new SandboxScopeStore(db);
    const directory = workspace("tool");
    const row = scopes.grant({
      projectId: "prj_a",
      path: directory,
      mode: "write",
      source: "question",
    });
    expect(row.path).toBe(resolve(directory));
    expect(row.source).toBe("question");

    const listed = scopes.list("prj_a");
    expect(listed.map((entry) => entry.path)).toContain(resolve(directory));
  });

  it("resolves a write grant as both readable and writable", () => {
    const scopes = new SandboxScopeStore(db);
    const directory = workspace("cargo-home");
    scopes.grant({ projectId: "prj_a", path: directory, mode: "write", source: "custom" });

    const roots = scopes.resolveRoots("prj_a");
    expect(roots.readRoots).toContain(resolve(directory));
    expect(roots.writeRoots).toContain(resolve(directory));
  });

  it("applies machine-wide rows to a conversation with no project", () => {
    const scopes = new SandboxScopeStore(db);
    const directory = workspace("shared");
    scopes.grant({ projectId: "", path: directory, mode: "read", source: "custom" });

    const roots = scopes.resolveRoots(undefined);
    expect(roots.readRoots).toContain(resolve(directory));

    // A project conversation sees both its own rows and the machine-wide ones.
    const projectRoots = scopes.resolveRoots("prj_other");
    expect(projectRoots.readRoots).toContain(resolve(directory));
  });

  it("resolves the git config as a standing read root", () => {
    // Owed to every conversation that runs a contained git, not to any row
    // the person chose: a contained git dies at exit 128 reading its
    // configuration when the container cannot read these files.
    const scopes = new SandboxScopeStore(db);
    expect(scopes.resolveRoots("prj_a").readRoots).toEqual(
      expect.arrayContaining([...gitConfigRoots()]),
    );
    expect(scopes.resolveRoots(undefined).readRoots).toEqual(
      expect.arrayContaining([...gitConfigRoots()]),
    );
  });

  it("names the git config files that exist, and nothing else", () => {
    if (process.platform !== "win32") return;
    // A fake home, because the assertion is about the shape - existing files
    // in, missing ones out - and not about this machine's own config.
    const home = workspace("home");
    writeFileSync(join(home, ".gitconfig"), "[user]\n");
    mkdirSync(join(home, ".config", "git"), { recursive: true });
    writeFileSync(join(home, ".config", "git", "config"), "[core]\n");
    writeFileSync(join(home, ".config", "git", "ignore"), "*.log\n");
    expect(gitConfigRoots({ USERPROFILE: home })).toEqual([
      join(home, ".gitconfig"),
      join(home, ".config", "git", "config"),
      join(home, ".config", "git", "ignore"),
    ]);
  });

  it("leaves out what is absent, and answers empty for an empty home", () => {
    if (process.platform !== "win32") return;
    const home = workspace("bare-home");
    writeFileSync(join(home, ".gitconfig"), "[user]\n");
    expect(gitConfigRoots({ USERPROFILE: home })).toEqual([join(home, ".gitconfig")]);
    expect(gitConfigRoots({ USERPROFILE: workspace("empty-home") })).toEqual([]);
    expect(gitConfigRoots({})).toEqual([]);
  });

  it("is empty off Windows, where the home is not inside the container", () => {
    if (process.platform === "win32") return;
    expect(gitConfigRoots({ USERPROFILE: workspace("home") })).toEqual([]);
  });

  it("refuses a system path whatever source it arrives under", () => {
    // The typed path is not the only way a system directory can reach the
    // store. A question the model phrased arrives here too, and a grant on a
    // system directory is the end of the boundary however it was written.
    const scopes = new SandboxScopeStore(db);
    const guarded =
      // The backslash is escaped. Written singly it was not an escape at all
      // and the fallback read as `C:Windows`, which is not a system directory
      // -- so on a machine with no SystemRoot this asserted the opposite of
      // what it says.
      process.platform === "win32" ? (process.env.SystemRoot ?? "C:\\Windows") : "/etc";
    for (const source of ["custom", "question"] as const) {
      expect(() =>
        scopes.grant({ projectId: "prj_a", path: guarded, mode: "read", source }),
      ).toThrow(/trusted/i);
    }
    expect(scopes.listProject("prj_a")).toEqual([]);
  });

  it("revokes one grant without touching the others", () => {
    const scopes = new SandboxScopeStore(db);
    const first = workspace("first");
    const second = workspace("second");
    scopes.grant({ projectId: "prj_a", path: first, mode: "read", source: "custom" });
    scopes.grant({ projectId: "prj_a", path: second, mode: "read", source: "custom" });

    expect(scopes.revoke("prj_a", first)).toBe(true);
    expect(scopes.listProject("prj_a").map((entry) => entry.path)).toEqual([
      resolve(second),
    ]);
  });

  it("clears a project's rows when the project goes", () => {
    const scopes = new SandboxScopeStore(db);
    const directory = workspace("gone");
    scopes.grant({ projectId: "prj_gone", path: directory, mode: "read", source: "custom" });
    scopes.clearProject("prj_gone");
    expect(scopes.listProject("prj_gone")).toHaveLength(0);
  });

  it("keeps a conversation grant to its conversation (migration 26)", () => {
    // The third scope. Read by the conversation that was granted it and by
    // no other, whichever project either is filed under; carried in neither
    // the project list nor the machine-wide list, so the settings pane
    // cannot mistake it for a durable one.
    const scopes = new SandboxScopeStore(db);
    const directory = workspace("downloads");
    const row = scopes.grant({
      projectId: "prj_a",
      conversationId: "cnv_1",
      path: directory,
      mode: "write",
      source: "question",
    });
    expect(row.projectId).toBe("");
    expect(row.conversationId).toBe("cnv_1");

    expect(scopes.resolveRoots("prj_a", "cnv_1").writeRoots).toContain(resolve(directory));
    expect(scopes.resolveRoots(undefined, "cnv_1").writeRoots).toContain(resolve(directory));
    expect(scopes.resolveRoots("prj_a", "cnv_2").readRoots).not.toContain(resolve(directory));
    expect(scopes.resolveRoots("prj_a").readRoots).not.toContain(resolve(directory));
    expect(scopes.listProject("prj_a")).toHaveLength(0);
    expect(scopes.listMachineWide()).toHaveLength(0);
    expect(scopes.listConversations().map((entry) => entry.conversationId)).toEqual(["cnv_1"]);
  });

  it("removes a conversation grant on its own, and all of them with the conversation", () => {
    const scopes = new SandboxScopeStore(db);
    const first = workspace("first");
    const second = workspace("second");
    scopes.grant({ projectId: "", conversationId: "cnv_1", path: first, mode: "read", source: "question" });
    scopes.grant({ projectId: "", conversationId: "cnv_1", path: second, mode: "read", source: "question" });
    // The same path machine-wide is a different row and survives both.
    scopes.grant({ projectId: "", path: first, mode: "read", source: "custom" });

    expect(scopes.revokeConversation("cnv_1", first)).toBe(true);
    expect(scopes.revoke("", second)).toBe(false);
    expect(scopes.listConversations().map((entry) => entry.path)).toEqual([resolve(second)]);
    expect(scopes.clearConversation("cnv_1")).toBe(1);
    expect(scopes.listConversations()).toHaveLength(0);
    expect(scopes.listMachineWide().map((entry) => entry.path)).toEqual([resolve(first)]);
  });

  it("refuses a blank conversation id", () => {
    const scopes = new SandboxScopeStore(db);
    expect(() =>
      scopes.grant({ projectId: "", conversationId: " ", path: workspace("x"), mode: "read", source: "question" }),
    ).toThrow(StorageError);
  });
});

describe("the policy build", () => {
  it("fills read and write roots from the scope table", () => {
    const scopes = new SandboxScopeStore(db);
    const directory = workspace("outside");
    scopes.grant({ projectId: "prj_a", path: directory, mode: "write", source: "question" });

    const work = workspace("work");
    const roots = scopes.resolveRoots("prj_a");
    const policy = createSandboxPolicy({
      workspaceRoot: work,
      readRoots: roots.readRoots,
      writeRoots: roots.writeRoots,
    });
    const sandbox = new LocalSandbox(policy);
    expect(sandbox.resolveWrite(join(directory, "planted.txt"))).toBe(
      resolve(directory, "planted.txt"),
    );
  });

  it("refuses the same path without the scope row", () => {
    const work = workspace("work");
    const outside = workspace("outside");
    const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: work }));
    expect(() => sandbox.resolveWrite(join(outside, "planted.txt"))).toThrow();
  });

  it("trusted resolves any absolute path and runs uncontained", async () => {
    const work = workspace("work");
    const sandbox = new LocalSandbox(
      createSandboxPolicy({ workspaceRoot: work, trusted: true }),
    );
    const outside = join(base, "anywhere", "file.txt");
    expect(sandbox.resolveRead(outside)).toBe(resolve(outside));
    expect(sandbox.resolveWrite(outside)).toBe(resolve(outside));

    const planned = await sandbox.plan("shell", {
      executable: process.execPath,
      args: ["-e", "0"],
    });
    expect(planned.executable).toBe(process.execPath);
  });

  it("contained is what an untouched project still gets", () => {
    const work = workspace("work");
    const policy = createSandboxPolicy({ workspaceRoot: work });
    expect(policy.trusted).toBe(false);
  });
});

describe("the refusal that becomes a question", () => {
  it("shows the resolved path, not the model's raw string", () => {
    const work = workspace("work");
    const raw = join("..", "work", "..", "outside", "..", "outside", "file.txt");
    const resolved = resolve(work, raw);
    const built = buildScopeQuestion({
      resolvedPath: resolved,
      rawPath: raw,
      program: "cargo",
      mode: "write",
    });
    expect(built.resolvedPath).toBe(resolve(resolved));
    expect(built.payload.question).toContain(resolve(resolved));
    expect(built.payload.question).not.toContain("..");
    // Four answers with a project: this conversation (recommended), this
    // project, everywhere, and no.
    expect(built.payload.options).toHaveLength(4);
    expect(built.payload.recommendedOptionId).toBe(SCOPE_QUESTION_OPTIONS.conversation);
  });

  it("writes the grant for this project, and the command can be retried", () => {
    const scopes = new SandboxScopeStore(db);
    const declines = new ScopeDeclines();
    const directory = workspace("rustup");
    const built = buildScopeQuestion({ resolvedPath: directory, program: "cargo" });

    const applied = applyScopeAnswer(scopes, {
      projectId: "prj_a",
      resolvedPath: built.resolvedPath,
      mode: "write",
      answer: { optionIds: [SCOPE_QUESTION_OPTIONS.project] },
      outcome: "answered",
      declines,
      conversationId: "cnv_1",
    });
    expect(applied.granted).toBe(true);
    expect(scopes.listProject("prj_a").map((entry) => entry.path)).toContain(
      resolve(directory),
    );
  });

  it("writes a machine-wide grant for every project", () => {
    const scopes = new SandboxScopeStore(db);
    const declines = new ScopeDeclines();
    const directory = workspace("cargo-wide");
    const built = buildScopeQuestion({ resolvedPath: directory, program: "cargo" });

    const applied = applyScopeAnswer(scopes, {
      projectId: "prj_a",
      resolvedPath: built.resolvedPath,
      mode: "write",
      answer: { optionIds: [SCOPE_QUESTION_OPTIONS.everywhere] },
      outcome: "answered",
      declines,
      conversationId: "cnv_1",
    });
    expect(applied.granted).toBe(true);
    expect(scopes.listMachineWide().map((entry) => entry.path)).toContain(
      resolve(directory),
    );
  });

  it("writes nothing when the person declines, and records the decline", () => {
    const scopes = new SandboxScopeStore(db);
    const declines = new ScopeDeclines();
    const directory = workspace("declined");
    const built = buildScopeQuestion({ resolvedPath: directory, program: "cargo" });

    const applied = applyScopeAnswer(scopes, {
      projectId: "prj_a",
      resolvedPath: built.resolvedPath,
      mode: "write",
      answer: { optionIds: [SCOPE_QUESTION_OPTIONS.deny] },
      outcome: "answered",
      declines,
      conversationId: "cnv_1",
    });
    expect(applied.granted).toBe(false);
    expect(scopes.list("prj_a")).toHaveLength(0);
    expect(declines.isDeclined("cnv_1", built.resolvedPath)).toBe(true);
  });

  it("does not ask a declined path twice in one conversation", () => {
    const declines = new ScopeDeclines();
    const directory = workspace("twice");
    declines.markDeclined("cnv_1", directory);
    expect(declines.isDeclined("cnv_1", directory)).toBe(true);
    expect(declines.isDeclined("cnv_2", directory)).toBe(false);
  });
});

describe("the validator", () => {
  it("refuses a volume root with a reason that names trusted", () => {
    const root = process.platform === "win32" ? "C:\\" : "/";
    expect(() => validateCustomScopePath(root)).toThrow(StorageError);
    expect(() => validateCustomScopePath(root)).toThrow(/trusted/i);
  });

  it("refuses a system directory with a reason that names trusted", () => {
    const guarded =
      process.platform === "win32"
        ? (process.env.SystemRoot ?? "C:\\Windows")
        : "/etc";
    expect(systemScopeRefusal(guarded)).toMatch(/trusted/);
    expect(() => validateCustomScopePath(guarded)).toThrow(/trusted/i);
  });

  it("refuses a relative path and a missing directory", () => {
    expect(() => validateCustomScopePath("relative/dir")).toThrow(/absolute/i);
    expect(() => validateCustomScopePath(join(base, "not-there"))).toThrow(/does not exist/i);
  });

  it("accepts a real directory", () => {
    const directory = workspace("real");
    expect(validateCustomScopePath(directory)).toBe(resolve(directory));
  });
});

describe("telling the model", () => {
  it("states the extra roots when the conversation has scope beyond its workspace", () => {
    const block = environmentBlock({
      workspace: "/work/project",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
      extraRoots: ["/home/user/.cargo", "/home/user/.rustup"],
    });
    expect(block).toContain("/home/user/.cargo");
    expect(block).toContain("/home/user/.rustup");
  });

  it("says nothing extra when there is no scope beyond the workspace", () => {
    const block = environmentBlock({
      workspace: "/work/project",
      kind: "conversation",
      git: false,
      today: "2026-08-30",
    });
    expect(block).not.toContain("Beyond your working directory");
  });
});

describe("a granted path actually works", () => {
  it("writes through the filesystem gate with the scope row, and is refused without it", async () => {
    const scopes = new SandboxScopeStore(db);
    const work = workspace(" contained-work");
    const outside = workspace("granted-outside");
    writeFileSync(join(outside, "keep.txt"), "keep", "utf8");

    const denied = new LocalSandbox(createSandboxPolicy({ workspaceRoot: work }));
    await expect(denied.writeFile(join(outside, "planted.txt"), "x")).rejects.toThrow();

    scopes.grant({ projectId: "prj_a", path: outside, mode: "write", source: "question" });
    const roots = scopes.resolveRoots("prj_a");
    const allowed = new LocalSandbox(
      createSandboxPolicy({
        workspaceRoot: work,
        readRoots: roots.readRoots,
        writeRoots: roots.writeRoots,
      }),
    );
    await allowed.writeFile(join(outside, "planted.txt"), "from inside");
    expect(existsSync(join(outside, "planted.txt"))).toBe(true);
  });
});
