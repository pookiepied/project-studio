import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../../src/contracts/capabilities.js";
import { PermissionError } from "../../../src/permissions/errors.js";
import { PermissionGrantStore } from "../../../src/permissions/grant-store.js";
import { PermissionKernel } from "../../../src/permissions/kernel.js";
import { resourceRule } from "../../../src/permissions/policy.js";
import { runProcess } from "../../../src/process/exec.js";
import { LocalSandbox } from "../../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../../src/storage/database.js";
import { CallGate } from "../../../src/tools/gate.js";
import {
  buildGitArgs,
  classifyGit,
  gitResource,
  isKnownSubcommand,
  registerGitTools,
} from "../../../src/tools/git/index.js";
import { resolveBinary } from "../../../src/vendor/resolver.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

const GIT = (() => {
  try {
    return resolveBinary("git").path;
  } catch {
    return undefined;
  }
})();

describe("every subcommand is allowed", () => {
  it("passes an ordinary command through", () => {
    const args = buildGitArgs({ subcommand: "log", args: ["--oneline", "-n", "5"] });

    expect(args).toContain("log");
    expect(args).toContain("--oneline");
    expect(args).toContain("--no-pager");
  });

  it("allows subcommands we have never heard of", () => {
    // The point of shipping git is that all of it works. A list that has to be
    // complete to be correct is wrong the day after it is written.
    expect(() => buildGitArgs({ subcommand: "rerere", args: ["status"] })).not.toThrow();
    expect(() => buildGitArgs({ subcommand: "whatever-is-new", args: [] })).not.toThrow();
  });

  it("puts user arguments after the subcommand, always", () => {
    // This ordering is what makes `-c` safe to allow: as git's own option it is
    // only interpreted before the subcommand.
    const args = buildGitArgs({ subcommand: "commit", args: ["-c", "HEAD"] });

    expect(args.indexOf("commit")).toBeLessThan(args.indexOf("HEAD"));
    expect(args.at(-2)).toBe("-c");
    expect(args.at(-1)).toBe("HEAD");
  });

  it("rejects a subcommand that is not a command name", () => {
    expect(() => buildGitArgs({ subcommand: "log; rm -rf /", args: [] })).toThrow(
      /plain command name/i,
    );
    expect(() => buildGitArgs({ subcommand: "--exec-path", args: [] })).toThrow();
  });
});

describe("options that run other programs are refused", () => {
  const hostile = [
    ["--upload-pack", "sh"],
    ["--upload-pack=sh"],
    ["--receive-pack=sh"],
    ["--exec=sh"],
    ["--exec-path=/tmp/evil"],
    ["--config=core.pager=sh"],
    ["--tree-filter", "rm -rf /"],
    ["--index-filter=sh"],
    ["--msg-filter=sh"],
  ];

  it.each(hostile)("refuses %s", (...args) => {
    expect(() => buildGitArgs({ subcommand: "clone", args })).toThrow(
      /can run other programs/i,
    );
  });

  it("refuses redirecting which repository is operated on", () => {
    // We set these ourselves for snapshots. From a caller they are an escape
    // from the project.
    for (const option of ["--git-dir=/other", "--work-tree=/other", "--namespace=x"]) {
      expect(() => buildGitArgs({ subcommand: "status", args: [option] })).toThrow();
    }
  });

  it("refuses filter-branch outright", () => {
    // Its whole purpose is running commands over history — that is `shell`
    // wearing a git hat, and shell is a separate, differently gated capability.
    expect(() => buildGitArgs({ subcommand: "filter-branch", args: [] })).toThrow(
      /arbitrary commands/i,
    );
  });

  it("names what it refused instead of dropping it", () => {
    // Silently dropping an option would run a command the caller did not ask
    // for, which is worse than refusing the one they did.
    expect(() => buildGitArgs({ subcommand: "fetch", args: ["--upload-pack=sh"] })).toThrow(
      /--upload-pack/,
    );
  });
});

describe("classification decides what is asked about", () => {
  it("separates reading, writing, and talking to a remote", () => {
    expect(classifyGit("log")).toBe("read");
    expect(classifyGit("status")).toBe("read");
    expect(classifyGit("commit")).toBe("write");
    expect(classifyGit("push")).toBe("network");
    expect(classifyGit("fetch")).toBe("network");
  });

  it("treats an unknown subcommand as writing", () => {
    // Fails safe without failing closed: it still runs, it just asks first.
    expect(classifyGit("some-new-command")).toBe("write");
    expect(isKnownSubcommand("some-new-command")).toBe(false);
  });

  it("treats a subcommand that both reads and writes as writing", () => {
    // `git config --get` only reads, but telling that from `git config --global
    // user.email` needs argument analysis we would have to keep in step with
    // git forever. Being asked once about a read is the smaller cost.
    expect(classifyGit("config")).toBe("write");
    expect(classifyGit("branch")).toBe("write");
  });

  it("matches on the command kind, not its arguments", () => {
    // Including arguments would make every commit a distinct resource, so
    // "always allow commits" could never be expressed.
    expect(gitResource("commit")).toBe("git:commit");
  });
});

describe("the tool", () => {
  let db: StudioDatabase;
  let workspace: string;
  let gate: CallGate;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    workspace = mkdtempSync(join(tmpdir(), "studio-git-"));

    gate = new CallGate({
      kernel: new PermissionKernel({
        grants: new PermissionGrantStore(db),
        approver: { request: async () => ({ verdict: "allow", duration: "always" }) },
        policy: [
          resourceRule({
            id: "no-push",
            capability: "native/git",
            resource: "git:push",
            kind: "command",
            verdict: "deny",
            reason: "Pushing is not allowed from here.",
          }),
        ],
      }),
      sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })),
    });
    registerGitTools(gate);
  });

  afterEach(() => {
    db.close();
    rmSync(workspace, { recursive: true, force: true });
  });

  const git = (input: unknown) =>
    gate.call({ name: "native/git", input, scope: SCOPE }) as Promise<string>;

  it("is one capability, not one per subcommand", () => {
    // A dozen tools would be a dozen permission surfaces for one capability.
    expect(gate.list().map((tool) => tool.id.name)).toEqual(["git"]);
  });

  it("declares read and write, not execute", () => {
    // The substrate rule: running a known binary with an argument vector we
    // built is not arbitrary execution. What governs `git push` is a permission
    // rule, not isolation.
    expect(gate.list()[0]?.effects).toEqual(["read", "write"]);
  });

  it("is not idempotent, because committing twice makes two commits", () => {
    expect(gate.list()[0]?.idempotent).toBe(false);
  });

  it("requires a subcommand", async () => {
    await expect(git({})).rejects.toThrow(/subcommand is required/i);
  });

  it("refuses a single argument string, which would need a shell to split", async () => {
    await expect(git({ subcommand: "log", args: "--oneline -n 5" })).rejects.toThrow(
      /list of separate arguments/i,
    );
  });

  it("refuses a dangerous option before asking the user about it", async () => {
    // Nobody should be asked to approve something that cannot run.
    await expect(
      git({ subcommand: "fetch", args: ["--upload-pack=sh"] }),
    ).rejects.toThrow(/can run other programs/i);
  });

  it("decides push and log separately", async () => {
    // The gap argument-level matching closed: without a resource these are one
    // capability, and approving either approves both.
    await expect(git({ subcommand: "push", args: [] })).rejects.toThrow(PermissionError);
  });

  it.runIf(GIT)("runs a real command in the project", async () => {
    await runProcess({ executable: GIT!, args: ["init"], cwd: workspace });

    expect(await git({ subcommand: "status", args: ["--porcelain"] })).toBeTypeOf("string");
  });

  it.runIf(GIT)("reports a non-zero exit rather than throwing", async () => {
    // `git diff --quiet` exits 1 to mean "there are differences". Throwing
    // would make a normal outcome look like a failure.
    await runProcess({ executable: GIT!, args: ["init"], cwd: workspace });

    expect(await git({ subcommand: "rev-parse", args: ["--verify", "nope"] })).toMatch(
      /exited with code/i,
    );
  });

  it.runIf(GIT)("refuses a subcommand that is a shell alias", async () => {
    // A repository's own config can define one, which would make "every
    // subcommand is allowed" mean "every command is allowed".
    await runProcess({ executable: GIT!, args: ["init"], cwd: workspace });
    await runProcess({
      executable: GIT!,
      args: ["config", "--local", "alias.pwn", "!sh -c 'echo owned'"],
      cwd: workspace,
    });

    await expect(git({ subcommand: "pwn", args: [] })).rejects.toThrow(/shell command/i);
  });

  it.runIf(GIT)("still allows an ordinary alias", async () => {
    await runProcess({ executable: GIT!, args: ["init"], cwd: workspace });
    await runProcess({
      executable: GIT!,
      args: ["config", "--local", "alias.st", "status --porcelain"],
      cwd: workspace,
    });
    writeFileSync(join(workspace, "a.txt"), "hello");

    expect(await git({ subcommand: "st", args: [] })).toContain("a.txt");
  });
});
