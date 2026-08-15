import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";

import { describe, expect, it } from "vitest";

import { SandboxError } from "../../src/sandbox/errors.js";
import {
  assertIsolationAvailable,
  containCommand,
  isolationAvailable,
  isolationForKind,
  ISOLATION_ENFORCED,
  OS_ISOLATION_BACKENDS,
  programRoots,
  ancestorsOf,
  selectIsolation,
  type ContainedCommand,
  type IsolationBackend,
} from "../../src/sandbox/isolation/index.js";
import { containArgs } from "../../src/sandbox/isolation/windows/launcher.js";
import { grantsFor, profileName } from "../../src/sandbox/isolation/windows/appcontainer.js";
import {
  NATIVE_PROVENANCE,
  type CapabilityDescriptor,
  type CapabilityEffect,
} from "../../src/contracts/capabilities.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";

/**
 * The seam meta-task #15 is built on, and the rules that keep it honest.
 *
 * Everything here runs on every platform, including the Windows-specific
 * argument and naming rules — those are pure functions on purpose, so the parts
 * of the Windows backend that can be checked anywhere are checked anywhere.
 * What genuinely needs Windows is in
 * `tests/integration/sandbox-appcontainer.test.ts`, which measures the kernel
 * rather than describing it.
 */

const workspace = process.cwd();

/** A whole descriptor; only `effects` matters to anything in this file. */
function capability(name: string, effects: readonly CapabilityEffect[]): CapabilityDescriptor {
  return {
    id: { namespace: "native", name },
    title: name,
    description: `${name} for the isolation tests`,
    effects,
    provenance: NATIVE_PROVENANCE,
    idempotent: false,
  };
}

function backend(name: string, available: boolean): IsolationBackend {
  return {
    name,
    level: "os",
    available: () => available,
    contain: async ({ executable, args }): Promise<ContainedCommand> => ({
      executable: `${name}-launcher`,
      args: ["--", executable, ...args],
    }),
    release: async () => {},
  };
}

describe("the kind of a child decides what contains it", () => {
  it("does not contain first-party tools", () => {
    // Not an oversight, and the reason is concrete: `runProcess` is the single
    // spawn point for the model's shell commands *and* for the `git` calls the
    // snapshot system depends on. Containing this row takes undo down with it.
    expect(isolationForKind("tool")).toBe("in-process");
  });

  it("requires OS isolation for anything we did not choose", () => {
    expect(isolationForKind("shell")).toBe("os");
    expect(isolationForKind("mcp-server")).toBe("os");
  });
});

describe("selectIsolation", () => {
  it("reports in-process with no backend, and enforces nothing", () => {
    const support = selectIsolation([]);
    expect(support.level).toBe("in-process");
    expect(support.backend).toBeUndefined();
    expect(support.enforcing).toBe(false);
  });

  it("enforces once a backend exists, even when this host cannot run it", () => {
    // The #32 case, stated exactly: the build has containment for this platform
    // and this machine cannot supply it. That is a refusal, not a fall-through.
    const support = selectIsolation([backend("bwrap", false)]);
    expect(support.level).toBe("in-process");
    expect(support.enforcing).toBe(true);
  });

  it("uses a backend that probes as available", () => {
    const support = selectIsolation([backend("appcontainer", true)]);
    expect(support.level).toBe("os");
    expect(support.backend?.name).toBe("appcontainer");
  });

  it("ignores an unavailable backend in favour of an available one", () => {
    // Order matters here in a way that is easy to get wrong: the first entry
    // must not win merely by being first.
    const support = selectIsolation([backend("bwrap", false), backend("appcontainer", true)]);
    expect(support.backend?.name).toBe("appcontainer");
  });
});

describe("assertIsolationAvailable", () => {
  it("throws unsupported_isolation when a backend exists and cannot deliver", () => {
    const support = selectIsolation([backend("bwrap", false)]);
    try {
      assertIsolationAvailable("os", support);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(SandboxError);
      // The kind matters, not just that something threw: `unsupported_isolation`
      // was declared in `sandbox/errors.ts` and raised nowhere at all until #32.
      expect((error as SandboxError).kind).toBe("unsupported_isolation");
    }
  });

  it("permits the shortfall while nothing is enforced", () => {
    expect(() => {
      assertIsolationAvailable("os", selectIsolation([]));
    }).not.toThrow();
  });

  it("permits anything the host already satisfies", () => {
    expect(isolationAvailable("in-process", selectIsolation([]))).toBe(true);
    expect(isolationAvailable("os", selectIsolation([backend("x", true)]))).toBe(true);
  });
});

describe("LocalSandbox consults the measured support", () => {
  const policy = createSandboxPolicy({ workspaceRoot: workspace });

  it("still admits execute while nothing is enforced", () => {
    const sandbox = new LocalSandbox(policy, selectIsolation([]));
    expect(sandbox.supports(capability("shell", ["execute"]))).toBe(true);
  });

  it("refuses execute once a backend exists that this host cannot run", () => {
    const sandbox = new LocalSandbox(policy, selectIsolation([backend("bwrap", false)]));
    expect(sandbox.supports(capability("shell", ["execute"]))).toBe(false);
  });

  it("keeps admitting read, which needs no isolation at all", () => {
    const sandbox = new LocalSandbox(policy, selectIsolation([backend("bwrap", false)]));
    expect(sandbox.supports(capability("read", ["read"]))).toBe(true);
  });

  it("wraps a shell command in the backend and leaves a tool alone", async () => {
    // The property the whole seam exists for, checked without spawning: what
    // reaches `runProcess` for a model-chosen program is the launcher, and what
    // reaches it for `git` is `git`.
    const sandbox = new LocalSandbox(policy, selectIsolation([backend("fake", true)]));
    const wrapped = await sandbox.plan("shell", { executable: "node", args: ["-e", "0"] });
    expect(wrapped.executable).toBe("fake-launcher");
    expect(wrapped.args).toEqual(["--", "node", "-e", "0"]);

    const bare = await sandbox.plan("tool", { executable: "git", args: ["status"] });
    expect(bare.executable).toBe("git");
    expect(bare.args).toEqual(["status"]);
  });
});

describe("every kind reaches the same verdict", () => {
  const policy = createSandboxPolicy({ workspaceRoot: workspace });

  it("contains an MCP server exactly as it contains a shell command", async () => {
    // These two are spawned by completely different code — one waits for an
    // exit, the other streams for a session — and the point of `containCommand`
    // is that the *decision* is nonetheless one function. A second copy of it
    // for MCP is how the two would drift.
    const support = selectIsolation([backend("fake", true)]);
    const request = { policy, executable: "node", args: ["server.js"], cwd: workspace };

    const shell = await containCommand("shell", { ...request, network: true }, support);
    const server = await containCommand("mcp-server", { ...request, network: true }, support);
    expect(server).toEqual(shell);
    expect(server.executable).toBe("fake-launcher");
  });

  it("refuses to start an MCP server a host cannot contain", async () => {
    // The refusal that matters most: a third party's program on a machine whose
    // build expects containment and cannot deliver it does not start at all.
    const support = selectIsolation([backend("bwrap", false)]);
    await expect(
      containCommand(
        "mcp-server",
        { policy, executable: "node", args: [], cwd: workspace, network: true },
        support,
      ),
    ).rejects.toThrow(SandboxError);
  });

  it("asks for the network only when the caller did", async () => {
    const asked: boolean[] = [];
    const recording: IsolationBackend = {
      name: "recording",
      level: "os",
      available: () => true,
      contain: async (request) => {
        asked.push(request.network);
        return { executable: "x", args: [] };
      },
      release: async () => {},
    };
    const support = selectIsolation([recording]);
    const base = { policy, executable: "node", args: [], cwd: workspace };
    await containCommand("shell", { ...base, network: false }, support);
    await containCommand("shell", { ...base, network: true }, support);
    expect(asked).toEqual([false, true]);
  });
});

describe("the Windows launcher's argument rules", () => {
  it("asks for internetClient only when the network was requested", () => {
    // The capability is the whole network policy in one flag, so its presence
    // and absence are both worth pinning. Measured behaviour behind it:
    // `internetClient` reaches the internet and is refused loopback and the
    // LAN, so this flag is "may call an API", not "may reach the machine".
    const base = { sid: "S-1-15-2-1", cwd: "C:\\p", executable: "n.exe", args: [] };
    expect(containArgs({ ...base, capabilities: ["internetClient"] }))
      .toContain("internetClient");
    expect(containArgs(base)).not.toContain("--capability");
  });

  it("puts the program after `--`, so its flags are never ours", () => {
    // `studio-contain` and the program it runs can both be given `--cwd`. The
    // separator is what decides whose it is, and getting the order wrong would
    // silently hand the launcher an argument the model wrote.
    const args = containArgs({
      sid: "S-1-15-2-1",
      cwd: "C:\\project",
      executable: "C:\\Windows\\System32\\where.exe",
      args: ["--cwd", "anything"],
    });
    expect(args.slice(0, 5)).toEqual(["run", "--sid", "S-1-15-2-1", "--cwd", "C:\\project"]);
    expect(args.indexOf("--")).toBe(5);
    expect(args.slice(6)).toEqual([
      "C:\\Windows\\System32\\where.exe",
      "--cwd",
      "anything",
    ]);
  });

  it("grants each root once, at the strongest mode it is owed", () => {
    // The bug this pins shipped for one test run: the roots were applied as a
    // write pass and then a read pass, and `SetEntriesInAcl` replaces a
    // trustee's entry rather than adding to it. The workspace root is on both
    // lists, so read won, and the agent could read its own project and not
    // write to it. One entry per path with the mode already decided is what
    // makes the order stop mattering.
    const modes = grantsFor({
      readRoots: ["C:\\project", "C:\\reference"],
      writeRoots: ["C:\\project"],
    });
    expect(modes.get("C:\\project")).toBe("write");
    expect(modes.get("C:\\reference")).toBe("read");
    expect(modes.size).toBe(2);
  });

  it("gives every workspace its own container name, and the same one each time", () => {
    const first = profileName("D:\\projects\\alpha");
    expect(profileName("D:\\projects\\alpha")).toBe(first);
    expect(profileName("D:\\other\\alpha")).not.toBe(first);
    // AppContainer names are limited to 64 characters and reject most
    // punctuation, which is why this is a hash and not the path.
    expect(first.length).toBeLessThanOrEqual(64);
    expect(first).toMatch(/^studio-[0-9a-f]{32}$/);
  });
});

describe("the two grants a contained program needs beyond its workspace", () => {
  it("grants the program's own tree, and the node_modules that holds its dependencies", () => {
    // Built on disk rather than as strings, because the function deliberately
    // ignores paths that do not exist — granting a directory that is not there
    // would be a permission entry nobody can account for later.
    const base = mkdtempSync(join(tmpdir(), "studio-roots-"));
    const packaged = join(base, "npm", "node_modules", "some-server", "dist");
    const loose = join(base, "tools");
    mkdirSync(packaged, { recursive: true });
    mkdirSync(loose, { recursive: true });
    writeFileSync(join(packaged, "index.js"), "");
    writeFileSync(join(loose, "server.js"), "");

    try {
      // The gap that broke every real MCP server: the launcher opens the
      // *executable* with our rights, so `node.exe` runs — and `server.js` is
      // read from inside the container, where it is not granted. The nearest
      // `node_modules` rather than the script's own folder, because package
      // managers hoist dependencies a level up, and a grant on the package
      // alone leaves the server unable to load them.
      expect(programRoots([join(packaged, "index.js")])).toEqual([
        join(base, "npm", "node_modules"),
      ]);

      // Outside a package tree there is nothing to walk up to, so the file's
      // own directory is the grant.
      expect(programRoots([join(loose, "server.js")])).toEqual([loose]);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("ignores anything that is not an absolute path to a real file", () => {
    // A relative argument would resolve against *our* working directory, which
    // is not where the child runs — granting that would be granting the wrong
    // folder while looking correct.
    expect(programRoots(["--flag", "relative/path.js", "10"])).toEqual([]);
  });

  it("lists every ancestor of a path, root first", () => {
    // Root first because that is the order the kernel checks them, and because
    // a diagnostic built from this list should name the *first* wall a program
    // will hit rather than the last.
    const chain = ancestorsOf(join("C:", "Users", "someone", "project", "file.js"));
    expect(chain).toEqual([
      `C:${sep}`,
      join("C:", "Users"),
      join("C:", "Users", "someone"),
      join("C:", "Users", "someone", "project"),
    ]);
  });

  it("does not spin on a path that is already a root", () => {
    // `dirname` is its own fixed point at the root. Without the guard this
    // loops forever instead of failing, which is the worst way to be wrong.
    expect(ancestorsOf(`C:${sep}`)).toEqual([`C:${sep}`]);
  });

});

describe("what this build knows how to contain, per platform", () => {
  it("registers a backend exactly where one has been written", () => {
    // Deliberately platform-shaped, and the reason is a distinction worth
    // keeping: *this build has an implementation* is knowledge fixed when the
    // code was written, while *it works on this machine* is `available()`.
    //
    // This assertion is what makes step 3 impossible to forget. The day the
    // `bwrap` backend lands, the Linux branch here fails — and that is the same
    // day the containment text in the README and ADRs 0019/0022/0024 stops
    // being wrong for a new reason (#41).
    if (process.platform === "win32") {
      expect(OS_ISOLATION_BACKENDS.map((entry) => entry.name)).toEqual(["appcontainer"]);
      expect(ISOLATION_ENFORCED).toBe(true);
    } else {
      expect(OS_ISOLATION_BACKENDS).toHaveLength(0);
      expect(ISOLATION_ENFORCED).toBe(false);
    }
  });

  it("derives enforcement from the registry rather than from a second switch", () => {
    // Deliberately *not* asserted as `ISOLATION_ENFORCED === length > 0`. That
    // was the first version of this test and it was a tautology — the constant
    // is computed from exactly that expression, so nothing could ever make it
    // fail. Caught by mutating the registry and watching it pass.
    //
    // What is worth pinning is the property that made the tautology tempting:
    // there is no way to register a backend and leave enforcement off, because
    // there is no independent switch to forget.
    expect(selectIsolation(OS_ISOLATION_BACKENDS).enforcing).toBe(ISOLATION_ENFORCED);
    expect(selectIsolation([backend("any", false)]).enforcing).toBe(true);
  });
});
