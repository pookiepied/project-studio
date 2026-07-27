import { mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  cacheDirectory,
  databasePath,
  installationRoot,
  managedBinaryDirectory,
  resolveConfigured,
  shippedBinaryDirectory,
  snapshotsDirectory,
  studioHome,
  studioPath,
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
    expect(studioPath("bin")).toBe(join(workspace, "bin"));
  });

  it("keeps everything the application owns in one place", () => {
    process.env.PROJECT_STUDIO_HOME = workspace;

    expect(databasePath()).toBe(join(workspace, "studio.db"));
    expect(managedBinaryDirectory()).toBe(join(workspace, "bin"));
    expect(snapshotsDirectory()).toBe(join(workspace, "snapshots"));
    expect(cacheDirectory()).toBe(join(workspace, "cache"));
  });
});

describe("nothing is resolved against the working directory", () => {
  it("does not put the database in whatever project is open", () => {
    // The harness runs with the user's project as its working directory. A
    // relative default would create our database inside their repository,
    // visible in their git status and duplicated per project.
    process.env.PROJECT_STUDIO_HOME = workspace;
    process.chdir(workspace);

    expect(resolveDatabasePath()).toBe(join(workspace, "studio.db"));
    expect(resolveDatabasePath()).not.toContain(join(workspace, "data"));
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

    expect(managedBinaryDirectory()).toBe(join(workspace, "bin"));
    expect(shippedBinaryDirectory()).not.toContain(workspace);
  });
});
