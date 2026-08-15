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

/**
 * Reaches a public address and says which wall it hit, then exits.
 *
 * `res.resume()` and the explicit `process.exit` are not tidiness. An unread
 * response keeps the socket open and the event loop alive, so the child runs
 * until the harness kills it — and a 30-second timeout reads exactly like a
 * blocked connection while actually being a script that forgot to finish.
 */
const NETWORK_PROBE = `
  const request = require("https").get("https://example.com", (response) => {
    response.resume();
    console.log("reached " + response.statusCode);
    process.exit(0);
  });
  request.on("error", (error) => { console.log("refused " + error.code); process.exit(0); });
  request.setTimeout(8000, () => { console.log("refused ETIMEDOUT"); process.exit(0); });
`;

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

  it("runs a program from a script file, not only from `-e`", async () => {
    // **The regression this file was written badly enough to miss.** Every
    // case here used `node -e`, which is the one invocation form that never
    // resolves a main module — so ten green tests all took the same shortcut
    // and shipped a containment that broke `node build.js`, the most ordinary
    // thing a user runs.
    //
    // Resolving a main module calls `realpath`, which stats *every* component
    // of the path up to the volume root, and an AppContainer needs an entry on
    // each one. The fix is in `windows/traversal.ts`; this is the assertion
    // that would have caught its absence.
    const script = join(workspace, "build.js");
    await writeFile(script, 'console.log("built from a file")', "utf8");
    const result = await sandbox.run("shell", {
      executable: NODE,
      args: [script],
      cwd: workspace,
      timeoutMs: 30_000,
    });
    expect(`${result.stdout}${result.stderr}`.trim()).toBe("built from a file");
    expect(result.exitCode).toBe(0);
  }, 60_000);

  it("takes the corridor back off the user's folders when released", async () => {
    // Releasing has to undo the ancestor entries too, and it has to do it
    // without walking the tree. The first version revoked with inheritance
    // propagation on, which meant undoing one entry on a home folder rewrote
    // every descendant — it did not fail, it simply never returned.
    const started = Date.now();
    await sandbox.releaseIsolation();
    expect(Date.now() - started).toBeLessThan(20_000);
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

  it("cannot reach the network when the operator switched it off", async () => {
    // The `allowNetwork` switch used to be enforced only by our own capability
    // check — a subprocess ignored it completely, which was the whole point of
    // ADR 0041. It is now a kernel fact: no `internetClient` capability, so
    // name resolution does not work, for the program as well as for us.
    const denied = new LocalSandbox(
      createSandboxPolicy({ workspaceRoot: workspace, allowNetwork: false }),
    );
    expect(await inside(denied, NETWORK_PROBE)).toMatch(/refused/);
  }, 60_000);

  it("reaches the internet when the operator allowed it", async () => {
    // Asserted alongside the refusal on purpose. A test that only proved the
    // network was blocked would still pass if containment blocked it always,
    // which is the state that makes every API-calling MCP server useless.
    expect(await inside(sandbox, NETWORK_PROBE)).toMatch(/reached \d+/);
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
