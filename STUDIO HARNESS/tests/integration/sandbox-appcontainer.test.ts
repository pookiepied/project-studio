import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostIsolation } from "../../src/sandbox/isolation/index.js";
import { launcherPath } from "../../src/sandbox/isolation/windows/launcher.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";

/**
 * Does the Windows container actually contain anything.
 *
 * This file exists because the alternative is a document that says it does.
 * Every claim in `isolation/windows/appcontainer.ts` is asserted here against
 * the kernel, from inside a real AppContainer, using the launcher that ships in
 * `vendor/` — not the one in `target/`, so what is measured is what a user gets.
 *
 * The spike this replaces got the central finding wrong by measuring through
 * `cmd /c dir`, which fails inside a container for reasons of its own and says
 * "Access is denied." while doing it. Nothing here goes through a program that
 * has opinions: the child is `node -e`, and what it reports is the errno the
 * syscall returned.
 */

const isWindows = process.platform === "win32";
const support = isWindows ? hostIsolation() : undefined;
const contained = isWindows && support?.backend !== undefined;

/**
 * Skipped, loudly, rather than silently passing.
 *
 * A suite that reports green on Linux for a Windows feature is a suite that
 * tells you containment works on a machine where it was never tried.
 */
const windows = contained ? describe : describe.skip;

const NODE = process.execPath;

/** Runs a snippet inside the sandbox and reports what it saw. */
async function inside(sandbox: LocalSandbox, script: string): Promise<string> {
  const result = await sandbox.run("shell", {
    executable: NODE,
    args: ["-e", script],
    cwd: sandbox.policy.workspaceRoot,
    timeoutMs: 30_000,
  });
  return `${result.stdout}${result.stderr}`.trim();
}

/** `ok` when the operation succeeded, or the errno the kernel gave. */
const REPORT = (body: string): string =>
  `try { ${body}; console.log("ok"); } catch (error) { console.log(error.code ?? String(error)); }`;

windows("a contained child on Windows", () => {
  let root = "";
  let workspace = "";
  let outside = "";
  let sandbox: LocalSandbox;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "studio-contain-"));
    workspace = join(root, "project");
    outside = join(root, "elsewhere");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(workspace, "inside.txt"), "in the project", "utf8");
    await writeFile(join(outside, "secret.txt"), "not the agent's business", "utf8");

    sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));
  }, 60_000);

  afterAll(async () => {
    // Always, even if an expectation failed. A leaked profile is a leaked
    // entry in the user's own folder permissions, and this suite creates real
    // ones on the real machine it runs on.
    await sandbox?.releaseIsolation().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }, 60_000);

  it("runs the launcher that ships, not the one in the build directory", async () => {
    const planned = await sandbox.plan("shell", { executable: NODE, args: [] });
    expect(planned.executable).toBe(launcherPath());
    expect(planned.executable).toContain("vendor");
  });

  it("still runs the program, and the program still works", async () => {
    expect(await inside(sandbox, 'console.log("alive")')).toBe("alive");
  }, 60_000);

  it("reads a file in the workspace", async () => {
    const path = JSON.stringify(join(workspace, "inside.txt"));
    expect(await inside(sandbox, `console.log(require("fs").readFileSync(${path}, "utf8"))`))
      .toBe("in the project");
  }, 60_000);

  it("lists the workspace — the enumeration limit was a measurement error", async () => {
    // The spike recorded this as refused and the whole plan was written around
    // it. It was `cmd`'s failure, not the kernel's. Asserted rather than noted,
    // because a correction that lives only in prose gets re-discovered.
    const path = JSON.stringify(workspace);
    const listing = await inside(
      sandbox,
      `console.log(require("fs").readdirSync(${path}).join(","))`,
    );
    expect(listing).toContain("inside.txt");
  }, 60_000);

  it("cannot read a directory outside the workspace", async () => {
    const path = JSON.stringify(join(outside, "secret.txt"));
    expect(await inside(sandbox, REPORT(`require("fs").readFileSync(${path}, "utf8")`)))
      .toMatch(/EPERM|EACCES/);
  }, 60_000);

  it("cannot list a directory outside the workspace", async () => {
    const path = JSON.stringify(outside);
    expect(await inside(sandbox, REPORT(`require("fs").readdirSync(${path})`))).toMatch(/EPERM|EACCES/);
  }, 60_000);

  it("cannot write outside the workspace", async () => {
    // The one that matters most. Reading someone else's file is a leak; writing
    // to it is damage the undo system cannot reach, because the snapshot only
    // covers the project.
    const path = JSON.stringify(join(outside, "planted.txt"));
    expect(await inside(sandbox, REPORT(`require("fs").writeFileSync(${path}, "x")`)))
      .toMatch(/EPERM|EACCES/);
  }, 60_000);

  it("writes inside the workspace, which is the point of having one", async () => {
    const path = JSON.stringify(join(workspace, "written.txt"));
    expect(await inside(sandbox, REPORT(`require("fs").writeFileSync(${path}, "from inside")`)))
      .toBe("ok");
    expect(await readFile(join(workspace, "written.txt"), "utf8")).toBe("from inside");
  }, 60_000);

  it("cannot reach the network", async () => {
    // Not a firewall rule and not a check of ours: an AppContainer declares the
    // capabilities it wants, this one declares none, and name resolution is
    // among the things that stop working as a result.
    const script = REPORT(
      'await new Promise((resolve, reject) => { const request = require("https").get("https://example.com", resolve); request.on("error", reject); request.setTimeout(8000, () => reject(new Error("ETIMEDOUT"))); })',
    );
    const seen = await inside(sandbox, `(async () => { ${script} })()`);
    expect(seen).not.toBe("ok");
  }, 60_000);

  it("takes its permission entry back off the user's directory", async () => {
    // The disclosed cost of this feature is an ACE on a folder the user owns.
    // A cost that cannot be undone is not a cost, it is a change.
    const before = execFileSync("icacls", [workspace], { encoding: "utf8" });
    expect(before).toContain("S-1-15-2-");

    await sandbox.releaseIsolation();

    const after = execFileSync("icacls", [workspace], { encoding: "utf8" });
    expect(after).not.toContain("S-1-15-2-");
  }, 60_000);
});
