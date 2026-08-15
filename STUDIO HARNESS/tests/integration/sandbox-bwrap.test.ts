import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { hostIsolation } from "../../src/sandbox/isolation/index.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";

/**
 * Does the Linux container actually contain anything.
 *
 * The sibling of `sandbox-appcontainer.test.ts`, asserting the same claims
 * against a different kernel, and written to the same rule: nothing here goes
 * through a program that has opinions. The child is `node -e`, and what it
 * reports is the errno the syscall returned — because the Windows spike got its
 * central finding wrong by measuring through `cmd /c dir`, which fails inside a
 * container for reasons of its own and says "Access is denied." while doing it.
 *
 * ## Two suites, and exactly one of them runs
 *
 * A Linux machine either has a usable `bwrap` or it does not, and both states
 * are worth asserting. Stock Ubuntu 24.04 is the second one — bubblewrap 0.9.0
 * installed, and the kernel still refuses the user namespace — so the refusal
 * path is not a hypothetical to leave untested. It is what a large share of
 * users will hit.
 */

const support = process.platform === "linux" ? hostIsolation() : undefined;
const contained = support?.backend !== undefined;

const linux = contained ? describe : describe.skip;
const refusing = support !== undefined && !contained ? describe : describe.skip;

const NODE = process.execPath;

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
 * The explicit exit is not tidiness. An unread response keeps the socket and
 * the event loop alive, so the child runs until the harness kills it — and a
 * timeout reads exactly like a blocked connection while actually being a script
 * that forgot to finish. That cost a wrong conclusion once already.
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

linux("a contained child on Linux", () => {
  let root = "";
  let workspace = "";
  let outside = "";
  let sandbox: LocalSandbox;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "studio-bwrap-"));
    workspace = join(root, "project");
    outside = join(root, "elsewhere");
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(join(workspace, "inside.txt"), "in the project", "utf8");
    await writeFile(join(outside, "secret.txt"), "not the agent's business", "utf8");

    sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));
  }, 60_000);

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  }, 60_000);

  it("runs the sandbox program the resolver found, not a bare name", async () => {
    // `runProcess` only accepts an absolute path, and "whatever `bwrap` means on
    // this PATH today" is not a program we chose.
    const planned = await sandbox.plan("shell", { executable: NODE, args: [] });
    expect(planned.executable).toMatch(/^\//);
    expect(planned.executable).toContain("bwrap");
  });

  it("still runs the program, and the program still works", async () => {
    expect(await inside(sandbox, 'console.log("alive")')).toBe("alive");
  }, 60_000);

  it("runs a program from a script file, not only from `-e`", async () => {
    // The regression the Windows suite was written badly enough to miss: every
    // case used `node -e`, the one invocation form that never resolves a main
    // module, so ten green tests all took the same shortcut past a containment
    // that broke `node build.js`. Asserted here from the first day rather than
    // after the same bug ships twice.
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

  it("reads a file in the workspace", async () => {
    const path = JSON.stringify(join(workspace, "inside.txt"));
    expect(await inside(sandbox, `console.log(require("fs").readFileSync(${path}, "utf8"))`))
      .toBe("in the project");
  }, 60_000);

  it("lists the workspace", async () => {
    const path = JSON.stringify(workspace);
    const listing = await inside(
      sandbox,
      `console.log(require("fs").readdirSync(${path}).join(","))`,
    );
    expect(listing).toContain("inside.txt");
  }, 60_000);

  it("writes inside the workspace, which is the point of having one", async () => {
    const path = JSON.stringify(join(workspace, "written.txt"));
    expect(await inside(sandbox, REPORT(`require("fs").writeFileSync(${path}, "from inside")`)))
      .toBe("ok");
    expect(await readFile(join(workspace, "written.txt"), "utf8")).toBe("from inside");
  }, 60_000);

  it("cannot read a file outside the workspace", async () => {
    const path = JSON.stringify(join(outside, "secret.txt"));
    expect(await inside(sandbox, REPORT(`require("fs").readFileSync(${path}, "utf8")`)))
      .toMatch(/ENOENT|EACCES|EPERM/);
  }, 60_000);

  it("cannot list a directory outside the workspace", async () => {
    const path = JSON.stringify(outside);
    expect(await inside(sandbox, REPORT(`require("fs").readdirSync(${path})`)))
      .toMatch(/ENOENT|EACCES|EPERM/);
  }, 60_000);

  it("cannot write outside the workspace", async () => {
    // The one that matters most. Reading someone else's file is a leak; writing
    // to it is damage the undo system cannot reach, because the snapshot only
    // covers the project.
    const path = JSON.stringify(join(outside, "planted.txt"));
    expect(await inside(sandbox, REPORT(`require("fs").writeFileSync(${path}, "x")`)))
      .toMatch(/ENOENT|EACCES|EPERM/);
  }, 60_000);

  it("cannot see anything in the user's home directory", async () => {
    // "The agent cannot read your home folder" is the claim a user actually
    // cares about, so it is asserted against real files rather than against the
    // folder itself — and the difference between those two is a measurement
    // that corrected this test rather than the code.
    //
    // The first version asserted that listing `$HOME` fails. It does not. It
    // returns exactly one entry, and the next test says why. Bind mounts make
    // an ungranted path *absent* rather than refused, which is a stronger
    // boundary than Windows', and `ENOENT` is what that looks like.
    const home = homedir();
    for (const path of [
      join(home, ".bashrc"),
      join(home, ".ssh", "authorized_keys"),
      join(home, "Documents"),
    ]) {
      const quoted = JSON.stringify(path);
      expect(await inside(sandbox, REPORT(`require("fs").statSync(${quoted})`)))
        .toMatch(/ENOENT|EACCES|EPERM/);
    }
  }, 60_000);

  it("shows only the empty skeleton of the path to its own program", async () => {
    // Why listing `$HOME` succeeds, pinned so nobody re-discovers it as a leak.
    //
    // To mount the program root, `bwrap` must create its mount point, and that
    // means materialising every parent directory inside the container. They are
    // empty directories on a tmpfs, not the user's. So a child whose runtime
    // lives under the home directory can list `$HOME` and see one entry: the
    // next component of the path to its own executable — which it was given as
    // `argv[0]` and already knows.
    //
    // Nothing is disclosed, and the reason it is asserted anyway is that
    // "listing the home directory works" is alarming until you know what it
    // returns. A property this surprising should fail loudly if it ever changes
    // into the real thing.
    const listing = await inside(
      sandbox,
      `console.log(JSON.stringify(require("fs").readdirSync(${JSON.stringify(homedir())})))`,
    );
    const entries = JSON.parse(listing) as string[];
    expect(entries.length).toBeLessThanOrEqual(1);
    for (const entry of entries) {
      expect(NODE.startsWith(join(homedir(), entry))).toBe(true);
    }
  }, 60_000);

  it("cannot see the host's other processes", async () => {
    // `--unshare-all` includes the PID namespace, so a contained child cannot
    // enumerate — or signal — anything it did not start. Nothing on Windows
    // corresponds to this; it is a boundary Linux gives away for free.
    const listing = await inside(
      sandbox,
      'console.log(require("fs").readdirSync("/proc").filter((n) => /^[0-9]+$/.test(n)).length)',
    );
    expect(Number(listing)).toBeLessThan(5);
  }, 60_000);

  it("cannot reach the network when the operator switched it off", async () => {
    // A kernel fact rather than our own check: without `--share-net` the child
    // has an empty network namespace, so there is nothing to resolve a name
    // with and nothing to route a packet through.
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

  it("leaves nothing behind on the user's disk", async () => {
    // The Windows backend adds an access-control entry to the project directory
    // and needs `release()` to take it back. This one writes nothing at all, so
    // the assertion is that releasing is a no-op that still returns — a
    // `release` that threw would break the maintenance command for everyone.
    await expect(sandbox.releaseIsolation()).resolves.toBeUndefined();
  }, 60_000);
});

refusing("a Linux kernel that will not hand out a namespace", () => {
  it("refuses the work instead of running it uncontained", async () => {
    // The state of stock Ubuntu 24.04: bubblewrap installed, and
    // `kernel.apparmor_restrict_unprivileged_userns=1` refusing the namespace
    // to any program without an AppArmor profile that grants `userns create`.
    //
    // This is the branch meta-task #15 is about. Before the seam, a shortfall
    // in isolation fell through a comment and ran the command anyway; the whole
    // point is that it now stops.
    const workspace = await mkdtemp(join(tmpdir(), "studio-bwrap-refuse-"));
    try {
      const sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));
      await expect(
        sandbox.run("shell", { executable: NODE, args: ["-e", "0"], cwd: workspace }),
      ).rejects.toThrow(/isolation/i);
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  }, 60_000);

  it("tells the user what was observed, not what we assume", async () => {
    // The remedy may be a guess; the cause must not be. `bwrap`'s own stderr is
    // quoted, because "run as administrator" printed to someone already
    // elevated is how the Windows half lost an afternoon.
    expect(support?.shortfall.join(" ")).toMatch(/sandbox program/i);
  });

  it("still declares that it enforces", () => {
    // The distinction the registry exists to keep: this build *has* a Linux
    // implementation, so a machine that cannot run it is refused rather than
    // quietly given `in-process`. A host with no backend registered at all
    // would report `enforcing: false`, and that is a different sentence.
    expect(support?.enforcing).toBe(true);
    expect(support?.level).toBe("in-process");
  });
});
