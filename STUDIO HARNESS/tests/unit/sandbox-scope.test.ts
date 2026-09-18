import { existsSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { environmentBlock } from "../../src/context/environment.js";
import { ProjectStore } from "../../src/projects/store.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy, gitConfigRoots } from "../../src/sandbox/policy.js";
import {
  detectPresets,
  SANDBOX_PRESETS,
  toolchainEnvironment,
  withToolchainDirectories,
} from "../../src/sandbox/presets.js";
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
    scopes.grant({ projectId: "", path: directory, mode: "read", source: "preset", presetId: "git" });

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
    // store. A preset whose candidates drifted, and a question the model
    // phrased, both arrive here too, and a grant on a system directory is the
    // end of containment however it was written.
    const scopes = new SandboxScopeStore(db);
    const guarded =
      // The backslash is escaped. Written singly it was not an escape at all
      // and the fallback read as `C:Windows`, which is not a system directory
      // -- so on a machine with no SystemRoot this asserted the opposite of
      // what it says.
      process.platform === "win32" ? (process.env.SystemRoot ?? "C:\\Windows") : "/etc";
    for (const source of ["preset", "question"] as const) {
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
    expect(built.payload.options).toHaveLength(3);
    expect(built.payload.recommendedOptionId).toBeUndefined();
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

describe("the catalog", () => {
  it("detects only what is on the machine, with the path it found", () => {
    const detected = detectPresets();
    for (const preset of detected) {
      expect(preset.paths.length).toBeGreaterThan(0);
      for (const entry of preset.paths) {
        expect(existsSync(entry.path)).toBe(true);
      }
    }
    // Eight or fewer: a ninth only with a measured failure.
    expect(detected.length).toBeLessThanOrEqual(8);
  });

  it("lists Git first when Git is present, because it unblocks the interpreter", () => {
    const detected = detectPresets();
    const git = detected.find((preset) => preset.id === "git");
    if (git === undefined) return;
    expect(detected[0]?.id).toBe("git");
  });

  it("ships eight presets and no Docker preset", () => {
    // The definition list is fixed at eight; detection only filters it.
    // Docker is a level choice, not a path preset.
    expect(SANDBOX_PRESETS.map((preset) => preset.id).sort()).toEqual(
      [
        "android-flutter",
        "dotnet",
        "git",
        "go",
        "java",
        "node-caches",
        "python",
        "rust",
      ].sort(),
    );
  });

  it.runIf(process.platform === "win32")("detects the Python interpreter's own installation, newest first", () => {
    // The measured defect this pins: the preset used to name only where
    // Python *stores* things — the pip cache, the user site-packages — and
    // never the place Python *is*. A contained shell that could not list the
    // interpreter's directory answered `python` with `not recognized`, and a
    // model that had just been told Python was granted reported that it
    // "can't find any Python". The installation directory is the preset's
    // first candidate, detected from the disk rather than from the PATH the
    // process happened to inherit.
    const home = mkdtempSync(join(tmpdir(), "studio-python-"));
    directories.push(home);
    for (const version of ["Python311", "Python312"]) {
      mkdirSync(join(home, "Programs", "Python", version), { recursive: true });
    }
    const detected = detectPresets({ ...process.env, LOCALAPPDATA: home });
    const python = detected.find((preset) => preset.id === "python");
    expect(python).toBeDefined();
    const installations = python?.paths.filter((path) => path.mode === "read") ?? [];
    expect(installations.map((entry) => entry.path)).toEqual([
      join(home, "Programs", "Python", "Python312"),
      join(home, "Programs", "Python", "Python311"),
    ]);
  });

  it.runIf(process.platform === "win32")("offers Flutter's own cache as a write grant beside the read-only SDK", () => {
    // The measured defect this pins: the SDK was granted read-only, and the
    // Flutter tool mutates `bin/cache` as part of running — version stamps,
    // the startup lock, the Dart SDK download. A contained `flutter` therefore
    // hung, silently, for as long as anyone was willing to watch. The SDK
    // stays read because it is program files; the one directory Flutter owns
    // and rewrites joins the write roots.
    const home = mkdtempSync(join(tmpdir(), "studio-flutter-"));
    directories.push(home);
    mkdirSync(join(home, "flutter", "bin", "cache"), { recursive: true });
    const detected = detectPresets({ ...process.env, HOME: home, USERPROFILE: home });
    const android = detected.find((preset) => preset.id === "android-flutter");
    expect(android).toBeDefined();
    const cache = android?.paths.find(
      (entry) => entry.path === join(home, "flutter", "bin", "cache"),
    );
    expect(cache?.mode).toBe("write");
  });

  it.runIf(process.platform === "win32")("offers corepack's cache with the other node caches", () => {
    // Corepack manages the pnpm payload a `pnpm` command line actually runs.
    // Its cache is a node cache like any other, and the measured reason it is
    // listed here: a contained process is handed a `LOCALAPPDATA` under its
    // own profile, so corepack starts empty and downloads pnpm again for
    // every profile while the payload already sits on the disk.
    const home = mkdtempSync(join(tmpdir(), "studio-corepack-"));
    directories.push(home);
    mkdirSync(join(home, "node", "corepack"), { recursive: true });
    const detected = detectPresets({ ...process.env, LOCALAPPDATA: home });
    const node = detected.find((preset) => preset.id === "node-caches");
    expect(node).toBeDefined();
    const cache = node?.paths.find((entry) => entry.path === join(home, "node", "corepack"));
    expect(cache?.mode).toBe("write");
  });
});

describe.runIf(process.platform === "win32")("the sandbox PATH's toolchain entries", () => {
  it("appends a toolchain directory the inherited PATH was missing, behind the person's own entries", () => {
    const home = mkdtempSync(join(tmpdir(), "studio-path-"));
    directories.push(home);
    const installed = join(home, "Programs", "Python", "Python311");
    mkdirSync(installed, { recursive: true });
    const env = {
      ...process.env,
      LOCALAPPDATA: home,
      ProgramFiles: join(home, "Program Files"),
      "ProgramFiles(x86)": join(home, "Program Files (x86)"),
    };

    const search = withToolchainDirectories("C:\\first", env);
    expect(search).toContain(installed);
    // The person's own PATH leads; the toolchain entry follows it.
    expect(search.startsWith("C:\\first;")).toBe(true);
  });

  it("adds nothing twice, and reads the same back twice", () => {
    const home = mkdtempSync(join(tmpdir(), "studio-path-once-"));
    directories.push(home);
    const installed = join(home, "Programs", "Python", "Python311");
    mkdirSync(installed, { recursive: true });
    const env = {
      ...process.env,
      LOCALAPPDATA: home,
      ProgramFiles: join(home, "Program Files"),
      "ProgramFiles(x86)": join(home, "Program Files (x86)"),
    };

    const once = withToolchainDirectories(installed, env);
    expect(once).toContain(installed);
    // Counted, so a name that is already on the PATH is never on it twice.
    expect(once.split(";").filter((entry) => entry === installed)).toHaveLength(1);
  });

  it("leads with the real JDK when the person's java comes from an unfollowable shim", () => {
    // The measured defect this pins: Oracle's `javapath` is a directory of
    // symlinks whose target carries no ALL APPLICATION PACKAGES entry. A
    // contained shell can list the shim and cannot follow it, so `java`
    // answered `not recognized` while `java -version` in the person's own
    // terminal worked. The installation's real `bin` leads instead.
    const home = mkdtempSync(join(tmpdir(), "studio-java-shim-"));
    directories.push(home);
    const programFiles = join(home, "Program Files");
    const realBin = join(programFiles, "Java", "jdk-17", "bin");
    mkdirSync(realBin, { recursive: true });
    writeFileSync(join(realBin, "java.exe"), "", "utf8");
    const shim = join(programFiles, "javapath");
    symlinkSync(realBin, shim, "junction");
    const env = {
      ...process.env,
      ProgramFiles: programFiles,
      "ProgramFiles(x86)": join(home, "Program Files (x86)"),
    };

    const search = withToolchainDirectories(shim, env);
    expect(search.startsWith(`${realBin};`)).toBe(true);
    // The shim keeps its place, it is simply no longer what java resolves to.
    expect(search.split(";")).toContain(shim);
  });

  it("keeps the person's PATH leading when no shim stands in front of java", () => {
    const home = mkdtempSync(join(tmpdir(), "studio-java-real-"));
    directories.push(home);
    const programFiles = join(home, "Program Files");
    const realBin = join(programFiles, "Java", "jdk-17", "bin");
    mkdirSync(realBin, { recursive: true });
    writeFileSync(join(realBin, "java.exe"), "", "utf8");
    const env = {
      ...process.env,
      ProgramFiles: programFiles,
      "ProgramFiles(x86)": join(home, "Program Files (x86)"),
    };

    const search = withToolchainDirectories("C:\\first", env);
    expect(search.startsWith("C:\\first;")).toBe(true);
    expect(search).not.toContain(realBin);
  });

  it("rebuilds the Visual Studio environment a developer prompt would set", () => {
    // The measured defect this pins: `rustc` finds MSVC through the registry,
    // and an AppContainer has no registry, so every link failed — first
    // LNK1181 for the missing kernel32.lib, then LNK1101 from a mismatched
    // mspdb140.dll picked out of the general PATH. Rebuilt from the disk,
    // the toolchain links.
    const home = mkdtempSync(join(tmpdir(), "studio-msvc-"));
    directories.push(home);
    const programFiles = join(home, "Program Files");
    const programFilesX86 = join(home, "Program Files (x86)");
    const toolsRoot = join(
      programFiles,
      "Microsoft Visual Studio",
      "2022",
      "Community",
      "VC",
      "Tools",
      "MSVC",
      "14.38.33130",
    );
    const hostBin = join(toolsRoot, "bin", "Hostx64", "x64");
    mkdirSync(hostBin, { recursive: true });
    writeFileSync(join(hostBin, "link.exe"), "", "utf8");
    const kitsRoot = join(programFilesX86, "Windows Kits", "10");
    const sdkVersion = "10.0.26100.0";
    for (const [directory, file] of [
      [join(kitsRoot, "Lib", sdkVersion, "um", "x64"), "kernel32.lib"],
      [join(kitsRoot, "Lib", sdkVersion, "ucrt", "x64"), "libucrt.lib"],
    ] as const) {
      mkdirSync(directory, { recursive: true });
      writeFileSync(join(directory, file), "", "utf8");
    }
    for (const include of ["ucrt", "shared", "um"]) {
      mkdirSync(join(kitsRoot, "Include", sdkVersion, include), { recursive: true });
    }
    mkdirSync(join(home, "node", "corepack"), { recursive: true });
    mkdirSync(join(home, "pnpm", "store"), { recursive: true });
    const env = {
      ...process.env,
      LOCALAPPDATA: home,
      ProgramFiles: programFiles,
      "ProgramFiles(x86)": programFilesX86,
    };

    const search = withToolchainDirectories("C:\\first", env);
    expect(search.startsWith(`${hostBin};`)).toBe(true);

    const toolchain = toolchainEnvironment(env);
    expect(toolchain["VCToolsVersion"]).toBe("14.38.33130");
    expect(toolchain["WindowsSDKVersion"]).toBe(`${sdkVersion}\\`);
    expect(toolchain["LIB"]?.split(";")).toContain(
      join(kitsRoot, "Lib", sdkVersion, "ucrt", "x64"),
    );
    expect(toolchain["INCLUDE"]?.split(";")).toContain(
      join(kitsRoot, "Include", sdkVersion, "shared"),
    );
    // The node caches ride beside the MSVC variables, for the same reason: a
    // contained process cannot find them where the OS would look.
    expect(toolchain["COREPACK_HOME"]).toBe(join(home, "node", "corepack"));
    expect(toolchain["pnpm_config_store_dir"]).toBe(join(home, "pnpm", "store"));
  });

  it("adds no toolchain environment when Visual Studio is not installed", () => {
    const home = mkdtempSync(join(tmpdir(), "studio-nomsvc-"));
    directories.push(home);
    const env = {
      ...process.env,
      LOCALAPPDATA: join(home, "localappdata"),
      ProgramFiles: join(home, "Program Files"),
      "ProgramFiles(x86)": join(home, "Program Files (x86)"),
    };
    expect(toolchainEnvironment(env)).toEqual({});
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
