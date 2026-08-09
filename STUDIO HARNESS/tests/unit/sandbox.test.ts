import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  CapabilityDescriptor,
  CapabilityEffect,
} from "../../src/contracts/capabilities.js";
import { SandboxError } from "../../src/sandbox/errors.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { isInsideRoot } from "../../src/sandbox/paths.js";
import {
  createSandboxPolicy,
  requiredIsolation,
  satisfiesIsolation,
} from "../../src/sandbox/policy.js";

function descriptor(
  effects: CapabilityEffect[],
  trusted = true,
): CapabilityDescriptor {
  return {
    id: { namespace: trusted ? "native" : "mcp:example", name: "thing" },
    title: "thing",
    description: "thing",
    effects,
    provenance: {
      origin: trusted ? "native" : "mcp",
      sourceId: trusted ? "project-studio" : "example-server",
      trusted,
    },
    idempotent: true,
  };
}

let base: string;
let workspace: string;
let outside: string;
let sandbox: LocalSandbox;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "studio-sandbox-"));
  workspace = join(base, "workspace");
  outside = join(base, "outside");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(outside, { recursive: true });
  writeFileSync(join(workspace, "inside.txt"), "inside");
  writeFileSync(join(outside, "secret.txt"), "secret");

  sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));
});

afterEach(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("path containment", () => {
  it("does not treat a string prefix as containment", () => {
    // `/work` is a prefix of `/work-secrets`. A startsWith check lets an agent
    // out of its workspace by naming a sibling directory.
    expect(isInsideRoot("/work", "/work-secrets/file")).toBe(false);
    expect(isInsideRoot("/work", "/work/file")).toBe(true);
  });

  it("treats the root itself as contained", () => {
    expect(isInsideRoot(workspace, workspace)).toBe(true);
  });

  it("resolves traversal before deciding, not by pattern matching", () => {
    for (const attempt of [
      "../outside/secret.txt",
      "./../outside/secret.txt",
      "a/b/../../../outside/secret.txt",
      "sub/../../outside/secret.txt",
    ]) {
      expect(() => sandbox.resolveRead(attempt)).toThrow(SandboxError);
    }
  });

  it("refuses an absolute path outside the workspace", () => {
    expect(() => sandbox.resolveRead(join(outside, "secret.txt"))).toThrow(
      SandboxError,
    );
  });

  it("allows a legitimate nested path", () => {
    expect(sandbox.resolveRead("inside.txt")).toBe(
      resolve(workspace, "inside.txt"),
    );
    expect(sandbox.resolveRead("nested/deeper/file.txt")).toBe(
      resolve(workspace, "nested/deeper/file.txt"),
    );
  });

  it("resolves relative paths against the workspace, not the process cwd", () => {
    // Inheriting process.cwd() would make a path mean different things
    // depending on where the harness was launched from.
    expect(sandbox.resolveRead("inside.txt").startsWith(workspace)).toBe(true);
  });

  it("refuses an empty or non-string path", () => {
    expect(() => sandbox.resolveRead("")).toThrow(SandboxError);
    expect(() => sandbox.resolveRead("   ")).toThrow(SandboxError);
  });

  it("follows symlinks rather than trusting the lexical path", () => {
    // A link inside the workspace pointing out of it resolves lexically to an
    // inside path. Only the real path reveals the escape.
    const link = join(workspace, "escape");
    try {
      symlinkSync(outside, link, "junction");
    } catch {
      return; // Symlink creation can require privileges; skip where it does.
    }

    expect(() => sandbox.resolveRead("escape/secret.txt")).toThrow(SandboxError);
  });

  it("permits writing a file that does not exist yet", () => {
    // realpath only works on existing paths, so a new file is checked through
    // the directory the write would actually land in.
    expect(sandbox.resolveWrite("brand-new.txt")).toBe(
      resolve(workspace, "brand-new.txt"),
    );
  });
});

describe("read and write roots are separate", () => {
  it("allows reading a project root without allowing writes to it", () => {
    const project = join(base, "project");
    mkdirSync(project, { recursive: true });
    writeFileSync(join(project, "readme.md"), "hello");

    const scoped = new LocalSandbox(
      createSandboxPolicy({
        workspaceRoot: workspace,
        readRoots: [project],
        writeRoots: [workspace],
      }),
    );

    expect(scoped.resolveRead(join(project, "readme.md"))).toBe(
      resolve(project, "readme.md"),
    );
    expect(() => scoped.resolveWrite(join(project, "readme.md"))).toThrow(
      SandboxError,
    );
  });

  it("refuses a policy whose writable root is not readable", () => {
    expect(() =>
      createSandboxPolicy({
        workspaceRoot: workspace,
        writeRoots: [outside],
      }),
    ).toThrow(/readable/i);
  });

  it("refuses a sibling that merely shares the root's name as a prefix", () => {
    // The case a string prefix cannot see: `…/work` is a prefix of
    // `…/work-secrets`. The test above only used a sibling with an unrelated
    // name, so it passed either way.
    expect(() =>
      createSandboxPolicy({
        workspaceRoot: join(base, "work"),
        writeRoots: [join(base, "work-secrets")],
      }),
    ).toThrow(/readable/i);
  });

  it("still accepts a writable root genuinely inside a readable one", () => {
    expect(() =>
      createSandboxPolicy({
        workspaceRoot: join(base, "work"),
        writeRoots: [join(base, "work", "src")],
      }),
    ).not.toThrow();
  });
});

describe("the policy is closed where closure is the protection", () => {
  it("starts with no environment, and with both capabilities on", () => {
    // The roots are the wall, and they are closed. The two capability switches
    // are not that wall and were never doing its job: an agent that cannot run
    // a command or reach the network is a text box. They exist so a
    // locked-down deployment has an answer without forking the code.
    const policy = createSandboxPolicy({ workspaceRoot: workspace });

    expect(policy.environment).toEqual({});
    expect(policy.allowExec).toBe(true);
    expect(policy.allowNetwork).toBe(true);
  });

  it("turns a capability off from the environment", () => {
    process.env.PROJECT_STUDIO_ALLOW_NETWORK = "off";
    try {
      expect(createSandboxPolicy({ workspaceRoot: workspace }).allowNetwork).toBe(false);
    } finally {
      delete process.env.PROJECT_STUDIO_ALLOW_NETWORK;
    }
  });

  it("ignores a misspelled switch rather than disabling half the agent", () => {
    process.env.PROJECT_STUDIO_ALLOW_EXEC = "flase";
    try {
      expect(createSandboxPolicy({ workspaceRoot: workspace }).allowExec).toBe(true);
    } finally {
      delete process.env.PROJECT_STUDIO_ALLOW_EXEC;
    }
  });

  it("lets an explicit argument beat the environment", () => {
    process.env.PROJECT_STUDIO_ALLOW_EXEC = "off";
    try {
      expect(
        createSandboxPolicy({ workspaceRoot: workspace, allowExec: true }).allowExec,
      ).toBe(true);
    } finally {
      delete process.env.PROJECT_STUDIO_ALLOW_EXEC;
    }
  });

  it("never hands the agent the host environment", () => {
    // Inheriting process.env would give the agent every token on the machine
    // and undo the credential design in one line.
    process.env.SANDBOX_LEAK_PROBE = "super-secret";
    const environment = sandbox.environment();

    expect(environment).not.toHaveProperty("SANDBOX_LEAK_PROBE");
    expect(Object.keys(environment)).toEqual([]);
    delete process.env.SANDBOX_LEAK_PROBE;
  });

  it("passes through only what the policy names", () => {
    const scoped = new LocalSandbox(
      createSandboxPolicy({
        workspaceRoot: workspace,
        environment: { LANG: "en_US.UTF-8" },
      }),
    );

    expect(scoped.environment()).toEqual({ LANG: "en_US.UTF-8" });
  });

  it("returns a copy, so a caller cannot mutate the policy through it", () => {
    const environment = sandbox.environment();
    environment.INJECTED = "x";

    expect(sandbox.environment()).not.toHaveProperty("INJECTED");
  });
});

describe("isolation is claimed honestly", () => {
  it("reports in-process isolation for the local sandbox", () => {
    expect(sandbox.isolation).toBe("in-process");
  });

  it("requires OS isolation for running code and reaching the network", () => {
    // Neither can be contained from inside our own process: a subprocess is
    // outside our path checks, and nothing in userspace Node stops a socket.
    expect(requiredIsolation("execute")).toBe("os");
    expect(requiredIsolation("network")).toBe("os");
    expect(requiredIsolation("read")).toBe("in-process");
    expect(requiredIsolation("write")).toBe("in-process");
  });

  it("allows what it can actually contain", () => {
    expect(() => sandbox.assertSupports(descriptor(["read"]))).not.toThrow();
    expect(() => sandbox.assertSupports(descriptor(["write"]))).not.toThrow();
  });

  it("refuses a capability the policy switched off", () => {
    // Both are on by default now, so this is about the switch doing its job
    // when someone uses it, not about the default.
    const locked = new LocalSandbox(
      createSandboxPolicy({
        workspaceRoot: workspace,
        allowExec: false,
        allowNetwork: false,
      }),
    );

    expect(() => locked.assertSupports(descriptor(["execute"]))).toThrow(SandboxError);
    expect(() => locked.assertSupports(descriptor(["network"]))).toThrow(SandboxError);
    expect(locked.supports(descriptor(["execute"]))).toBe(false);
    // Reading is untouched by either switch.
    expect(locked.supports(descriptor(["read"]))).toBe(true);
  });

  it("answers `supports` with the same rule `assertSupports` uses", () => {
    // Two copies of one meaning is what T-28 was. The list the model is shown
    // and the decision on the call have to come from the same place.
    const open = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));

    expect(open.supports(descriptor(["network"]))).toBe(true);
    expect(open.supports(descriptor(["execute"], false))).toBe(false);
  });

  it("runs a native program when the policy opted in, uncontained and said so", () => {
    // ADR 0019. Containing hostile code needs OS isolation and still does.
    // Running a program the user chose, in a folder they trusted, with their
    // approval is not containment — it is doing as asked.
    const permissive = new LocalSandbox(
      createSandboxPolicy({ workspaceRoot: workspace, allowExec: true }),
    );

    expect(() => permissive.assertSupports(descriptor(["execute"]))).not.toThrow();
  });

  it("never runs a connected server's code, whatever the policy says", () => {
    // The line is provenance, and it is absolute in this direction. This is
    // what S-02 keeps closed until a real isolation tier exists.
    const permissive = new LocalSandbox(
      createSandboxPolicy({
        workspaceRoot: workspace,
        allowExec: true,
        allowNetwork: true,
      }),
    );

    expect(() =>
      permissive.assertSupports(descriptor(["execute"], false)),
    ).toThrow(/needs a sandbox/i);
    expect(() =>
      permissive.assertSupports(descriptor(["network"], false)),
    ).toThrow(/needs a sandbox/i);
  });

  it("ranks isolation so a stronger sandbox satisfies a weaker requirement", () => {
    expect(satisfiesIsolation("remote-vm", "os")).toBe(true);
    expect(satisfiesIsolation("os", "in-process")).toBe(true);
    expect(satisfiesIsolation("in-process", "os")).toBe(false);
  });
});

describe("filesystem operations go through containment", () => {
  it("reads and writes inside the workspace", async () => {
    await sandbox.writeFile("notes/todo.md", "hello");
    expect(await sandbox.readFile("notes/todo.md")).toBe("hello");
  });

  it("refuses to read outside", async () => {
    await expect(sandbox.readFile("../outside/secret.txt")).rejects.toThrow(
      SandboxError,
    );
  });

  it("refuses to write outside", async () => {
    await expect(
      sandbox.writeFile("../outside/planted.txt", "x"),
    ).rejects.toThrow(SandboxError);
  });

  it("refuses to remove outside", async () => {
    await expect(sandbox.remove("../outside/secret.txt")).rejects.toThrow(
      SandboxError,
    );
  });

  it("refuses to remove the workspace root itself", async () => {
    await expect(sandbox.remove(".")).rejects.toThrow(/workspace root/i);
  });

  it("refuses an existence probe outside instead of answering it", async () => {
    // Answering "no" would let an agent map the filesystem by asking.
    await expect(sandbox.exists("../outside/secret.txt")).rejects.toThrow(
      SandboxError,
    );
  });

  it("reports a missing inside path as absent", async () => {
    expect(await sandbox.exists("not-here.txt")).toBe(false);
    expect(await sandbox.exists("inside.txt")).toBe(true);
  });
});

describe("refusals do not leak", () => {
  it("names the boundary rather than echoing the attempted path", () => {
    // The attempted path is model-produced and may embed content the model was
    // working with.
    let error: SandboxError | undefined;
    try {
      sandbox.resolveRead("../outside/secret.txt");
    } catch (caught) {
      error = caught as SandboxError;
    }

    expect(error?.code).toBe("sandbox.path_escape");
    expect(error?.message).not.toContain("secret.txt");
    expect(error?.message).not.toContain(outside);
  });
});
