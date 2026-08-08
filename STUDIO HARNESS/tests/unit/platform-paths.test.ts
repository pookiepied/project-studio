import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cacheDirectory,
  databasePath,
  durableDirectories,
  installationRoot,
  logsDirectory,
  managedBinaryDirectory,
  projectsDirectory,
  resolveConfigured,
  sessionsDirectory,
  settingsPath,
  shippedBinaryDirectory,
  snapshotsDirectory,
  studioHome,
  studioPath,
  temporaryDirectory,
} from "../../src/platform/paths.js";
import { resolveDatabasePath } from "../../src/storage/database.js";

let previousHome: string | undefined;
let workspace: string;
let previousCwd: string;

beforeEach(() => {
  previousHome = process.env.PROJECT_STUDIO_HOME;
  delete process.env.PROJECT_STUDIO_HOME;
  workspace = mkdtempSync(join(tmpdir(), "studio-paths-"));
  previousCwd = process.cwd();
});

afterEach(() => {
  process.chdir(previousCwd);
  if (previousHome === undefined) delete process.env.PROJECT_STUDIO_HOME;
  else process.env.PROJECT_STUDIO_HOME = previousHome;
  rmSync(workspace, { recursive: true, force: true });
});

describe("the Studio home", () => {
  it("lives beside the user's other tool directories", () => {
    expect(studioHome()).toBe(join(homedir(), ".studio"));
  });

  it("can be relocated", () => {
    process.env.PROJECT_STUDIO_HOME = workspace;

    expect(studioHome()).toBe(workspace);
    expect(studioPath("tools", "bin")).toBe(join(workspace, "tools", "bin"));
  });

  it("groups by what happens if you delete it", () => {
    // The question every other property follows from: what to back up, what to
    // sync, and what a "clear caches" button may remove.
    process.env.PROJECT_STUDIO_HOME = workspace;

    expect(databasePath()).toBe(join(workspace, "data", "studio.db"));
    expect(snapshotsDirectory()).toBe(join(workspace, "data", "snapshots"));
    expect(settingsPath()).toBe(join(workspace, "config", "settings.json"));
    expect(managedBinaryDirectory()).toBe(join(workspace, "tools", "bin"));
    expect(cacheDirectory()).toBe(join(workspace, "cache"));
  });

  it("keeps every top-level directory inside the agreed categories", () => {
    // A seventh sibling appearing at the top level is how a home becomes the
    // forty-entry mess this layout exists to avoid.
    process.env.PROJECT_STUDIO_HOME = workspace;
    const categories = new Set(["config", "data", "tools", "logs", "cache", "tmp"]);

    for (const path of [
      databasePath(),
      snapshotsDirectory(),
      settingsPath(),
      managedBinaryDirectory(),
      projectsDirectory(),
      sessionsDirectory(),
      logsDirectory(),
      cacheDirectory(),
      temporaryDirectory(),
    ]) {
      const top = relative(workspace, path).split(/[\\/]/)[0];
      expect(categories).toContain(top);
    }
  });

  it("can enumerate what a backup must keep", () => {
    // Derived from the same accessors everything else uses, so a new durable
    // directory cannot be added and then forgotten by the backup.
    process.env.PROJECT_STUDIO_HOME = workspace;

    expect(durableDirectories()).toEqual([
      join(workspace, "config"),
      join(workspace, "data"),
    ]);
    expect(durableDirectories()).not.toContain(cacheDirectory());
  });
});

describe("nothing is resolved against the working directory", () => {
  it("does not put the database in whatever project is open", () => {
    // The harness runs with the user's project as its working directory. A
    // relative default would create our database inside their repository,
    // visible in their git status and duplicated per project.
    // The home and the working directory must be *different* here, or the
    // assertion passes for the wrong reason.
    const project = mkdtempSync(join(tmpdir(), "studio-project-"));
    process.env.PROJECT_STUDIO_HOME = workspace;
    process.chdir(project);

    try {
      expect(resolveDatabasePath()).toBe(join(workspace, "data", "studio.db"));
      expect(resolveDatabasePath()).not.toContain(project);
    } finally {
      process.chdir(previousCwd);
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("keeps :memory: as a database with no file at all", () => {
    expect(resolveDatabasePath({ path: ":memory:" })).toBe(":memory:");
  });

  it("reads a relative setting as relative to the Studio home", () => {
    // So configuration means the same thing regardless of where the process was
    // started from.
    process.env.PROJECT_STUDIO_HOME = workspace;

    expect(resolveConfigured("nested/thing.db")).toBe(join(workspace, "nested/thing.db"));
    expect(resolveConfigured(join(workspace, "absolute.db"))).toBe(
      join(workspace, "absolute.db"),
    );
  });

  it("finds shipped assets in the installation, not the open project", () => {
    process.chdir(workspace);

    // Were this cwd-relative, any repository could ship its own binaries here
    // and have the harness run them.
    expect(shippedBinaryDirectory()).not.toBe(join(workspace, "vendor"));
    expect(installationRoot().replaceAll("\\", "/")).toMatch(/Project Studio V2$/);
  });
});

describe("shipped and downloaded binaries are kept apart", () => {
  it("puts what we downloaded in the user's home, not the installation", () => {
    // A packaged installation is read-only — under Program Files on Windows, in
    // an app bundle elsewhere — so anything acquired at runtime cannot go there.
    process.env.PROJECT_STUDIO_HOME = workspace;

    expect(managedBinaryDirectory()).toBe(join(workspace, "tools", "bin"));
    expect(shippedBinaryDirectory()).not.toContain(workspace);
  });
});
