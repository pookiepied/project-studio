import { mkdtemp, mkdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostIsolation } from "../../src/sandbox/isolation/index.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";

/**
 * A granted path actually works, against real containment.
 *
 * With a scope row for a directory outside the workspace, a contained command
 * can write there; without it, the same command is refused. This is the whole
 * task and it is an integration test against real containment, not a unit test
 * against the policy object.
 *
 * Every directory granted here is one the test created and removes afterwards.
 *
 * This runs where a backend exists - Linux with `bwrap` - and is skipped
 * elsewhere. On Windows there is no container to measure since ADR 0057; the
 * in-process half of the same property, that the sandbox's own file
 * operations refuse a path outside the roots, is in the unit suite.
 */

const support = hostIsolation();
const contained = support.backend !== undefined;
const runner = contained ? describe : describe.skip;

const NODE = process.execPath;

runner("a scope grant under real containment", () => {
  let root = "";
  let workspace = "";
  let outside = "";
  let denied: LocalSandbox;
  let allowed: LocalSandbox;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "studio-scope-contain-"));
    workspace = join(root, "project");
    outside = join(root, "elsewhere");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });

    denied = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));
    allowed = new LocalSandbox(
      createSandboxPolicy({
        workspaceRoot: workspace,
        readRoots: [outside],
        writeRoots: [outside],
      }),
    );
  }, 60_000);

  afterAll(async () => {
    await denied?.releaseIsolation().catch(() => {});
    await allowed?.releaseIsolation().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }, 60_000);

  it("refuses a write outside the workspace without the grant", async () => {
    const target = JSON.stringify(join(outside, "planted.txt"));
    const result = await denied.run("shell", {
      executable: NODE,
      args: ["-e", `try { require("fs").writeFileSync(${target}, "x"); console.log("ok"); } catch (error) { console.log(error.code ?? String(error)); }`],
      cwd: workspace,
      timeoutMs: 30_000,
    });
    expect(`${result.stdout}${result.stderr}`.trim()).toMatch(/EPERM|EACCES/);
  }, 60_000);

  it("writes outside the workspace with the grant", async () => {
    const target = JSON.stringify(join(outside, "granted.txt"));
    const result = await allowed.run("shell", {
      executable: NODE,
      args: ["-e", `try { require("fs").writeFileSync(${target}, "from inside"); console.log("ok"); } catch (error) { console.log(error.code ?? String(error)); }`],
      cwd: workspace,
      timeoutMs: 30_000,
    });
    expect(`${result.stdout}${result.stderr}`.trim()).toBe("ok");
    expect(await readFile(join(outside, "granted.txt"), "utf8")).toBe("from inside");
  }, 60_000);
});
