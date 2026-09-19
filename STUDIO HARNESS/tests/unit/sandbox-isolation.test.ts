import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
  bwrapArgs,
  selectIsolation,
  unprivilegedIdentity,
  withNarrowedNetwork,
  NETWORK_SETUP,
  PRIVATE_V4,
  PRIVATE_V6,
  type BwrapInput,
  type ContainedCommand,
  type IsolationBackend,
} from "../../src/sandbox/isolation/index.js";
import {
  elevationInstructions,
  profileText,
  PROFILE_PATH,
} from "../../src/sandbox/isolation/linux/apparmor.js";
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
 * Everything here runs on every platform, including the Linux backend's
 * argument rules - those are pure functions on purpose, so the parts of the
 * backend that can be checked anywhere are checked anywhere. What genuinely
 * needs a Linux kernel is in `tests/integration/sandbox-bwrap.test.ts`, which
 * measures the kernel rather than describing it. The Windows backend's rules
 * were here too, until ADR 0057 removed the backend.
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

describe("the Linux launcher's argument rules", () => {
  // Pure-function tests, run on every platform for the same reason the Windows
  // ones are: what a command line *says* is checkable anywhere, and what the
  // kernel does with it is measured in `tests/integration/sandbox-bwrap.test.ts`
  // on a machine that has one.
  const base: BwrapInput = {
    cwd: "/home/u/project",
    executable: "/usr/bin/node",
    args: [],
    readRoots: [],
    writeRoots: [],
    programRoots: [],
    network: false,
  };

  /** The mode `bwrap` would end up applying to a path — last mention wins. */
  function modeOf(args: readonly string[], path: string): string | undefined {
    let mode: string | undefined;
    for (let index = 0; index < args.length; index += 1) {
      if (args[index] !== path) continue;
      const flag = args[index - 1];
      if (flag === "--bind" || flag === "--ro-bind" || flag === "--ro-bind-try") {
        mode = flag;
      }
    }
    return mode;
  }

  it("unshares everything, and shares the network back only when asked", () => {
    // One flag is the whole network policy, exactly as `internetClient` is on
    // Windows. `--unshare-all` already includes the network namespace, so the
    // default is refusal and `--share-net` is the only thing that undoes it.
    expect(bwrapArgs(base)).toContain("--unshare-all");
    expect(bwrapArgs(base)).not.toContain("--share-net");
    expect(bwrapArgs({ ...base, network: true })).toContain("--share-net");
  });

  it("binds name resolution and certificates only with the network", () => {
    // Bound individually rather than by handing over the whole of `/etc`. The
    // child's business is its own API call, not the machine's user list.
    expect(bwrapArgs({ ...base, network: true })).toContain("/etc/resolv.conf");
    expect(bwrapArgs(base)).not.toContain("/etc/resolv.conf");

    // And the stub-resolver case, which only appeared once the child stopped
    // sharing the host's network namespace: `systemd-resolved` writes
    // `nameserver 127.0.0.53`, and inside the namespace that is the child's own
    // loopback. The real upstreams are bound over it, and *after* it, because a
    // later `bwrap` mount wins.
    const withNetwork = bwrapArgs({ ...base, network: true });
    const upstream = withNetwork.indexOf("/run/systemd/resolve/resolv.conf");
    expect(upstream).toBeGreaterThan(withNetwork.indexOf("/etc/resolv.conf"));
    expect(withNetwork[upstream + 1]).toBe("/etc/resolv.conf");
  });

  it("dies with its parent and drops the controlling terminal", () => {
    // Neither is decoration. A child that outlives the harness keeps its mounts
    // and stops being contained by anything we control; a child that keeps a
    // terminal can push characters back into it with TIOCSTI, which is a
    // contained program typing at the user's shell.
    expect(bwrapArgs(base)).toContain("--die-with-parent");
    expect(bwrapArgs(base)).toContain("--new-session");
  });

  it("gives a root that is both readable and writable the stronger mode", () => {
    // The same rule the Windows backend spells out in `grantsFor`, where it had
    // to be a map because `SetEntriesInAcl` replaces an entry. Here it is an
    // ordering, because `bwrap` lets the last mount win — and the workspace
    // root is on both lists, so getting it backwards is a sandbox that can read
    // its own project and not write to it. That shipped once already.
    const args = bwrapArgs({
      ...base,
      readRoots: ["/home/u/project"],
      writeRoots: ["/home/u/project"],
    });
    expect(modeOf(args, "/home/u/project")).toBe("--bind");
  });

  it("lets the policy's roots override the system ones", () => {
    // A workspace under a system path is still the workspace. System mounts are
    // laid down first for exactly this reason.
    const args = bwrapArgs({ ...base, writeRoots: ["/usr/local/src/project"] });
    expect(args.lastIndexOf("/usr")).toBeLessThan(args.indexOf("/usr/local/src/project"));
  });

  it("keeps a program root read-only even when it is listed twice", () => {
    // Program files are the one thing that never becomes writable by being
    // mentioned again: they are applied before the policy, so a genuine write
    // root still wins, but nothing about being a program grants a write.
    const args = bwrapArgs({ ...base, programRoots: ["/opt/tool"] });
    expect(modeOf(args, "/opt/tool")).toBe("--ro-bind-try");
  });

  it("puts the program after `--`, so its flags are never ours", () => {
    // `bwrap` and the program it runs can both be given `--chdir`. The
    // separator decides whose it is, and the model writes the second list.
    const args = bwrapArgs({
      ...base,
      executable: "/usr/bin/env",
      args: ["--chdir", "anything"],
    });
    const separator = args.indexOf("--");
    expect(args.slice(separator)).toEqual([
      "--",
      "/usr/bin/env",
      "--chdir",
      "anything",
    ]);
  });

  it("tolerates system directories a distribution does not have", () => {
    // `/lib64` is absent on some distributions and `/bin` is a symlink on
    // merged-`/usr` ones. A hard bind on a path that is not there fails the
    // whole launch, so only `/usr` — the one that is never optional — is
    // allowed to be fatal.
    const args = bwrapArgs(base);
    expect(modeOf(args, "/usr")).toBe("--ro-bind");
    expect(modeOf(args, "/lib64")).toBe("--ro-bind-try");
  });
});

describe("what a granted network means on Linux", () => {
  // The whole point of #93 is that "the network is allowed" meant two different
  // things on the two platforms. These pin the argument vector; the integration
  // suite measures what the kernel does with it.

  const inner = ["bwrap", "--unshare-all", "--share-net", "--", "node", "x.js"];

  it("turns off pasta's port forwarding, all four of it", () => {
    // Not hardening trim. Pasta's *default* forwards every port between the
    // namespace and the host's loopback, and with these left out a contained
    // child reached a server on the host's 127.0.0.1 exactly as it did through
    // `--share-net` — the defect this closes, reintroduced by omission.
    const args = withNarrowedNetwork("/usr/bin/pasta", "/bin/sh", inner);
    for (const flag of ["-t", "-u", "-T", "-U"]) {
      expect(args[args.indexOf(flag) + 1]).toBe("none");
    }
  });

  it("runs the contained command inside the namespace it built", () => {
    const args = withNarrowedNetwork("/usr/bin/pasta", "/bin/sh", inner);
    expect(args[0]).toBe("/usr/bin/pasta");
    // `sh` sits between the setup script and the command as `$0`, so the
    // caller's executable lands at `$1` and `exec "$@"` runs the right thing.
    expect(args.slice(-inner.length - 1)).toEqual(["sh", ...inner]);
  });

  it("never interpolates the command into the shell script", () => {
    // The reason the script is a constant. A program whose path contained a
    // quote or a semicolon would otherwise become shell syntax, and the argument
    // for the sandbox does not survive the sandbox launching arbitrary commands.
    const hostile = ["bwrap", "; rm -rf /", "$(whoami)", "'"];
    const args = withNarrowedNetwork("/usr/bin/pasta", "/bin/sh", hostile);
    const script = args[args.indexOf("-c") + 1] ?? "";
    expect(script).toBe(NETWORK_SETUP);
    for (const piece of hostile) expect(script).not.toContain(piece);
  });

  it("refuses the ranges Windows refuses, including the two easy to forget", () => {
    // RFC1918 is the obvious half. `100.64.0.0/10` is carrier-grade NAT, where
    // Tailscale and most mesh VPNs live — measured reachable before this, on a
    // real peer. `169.254.0.0/16` is link-local, home of 169.254.169.254, every
    // cloud provider's unauthenticated credentials endpoint.
    expect(PRIVATE_V4).toEqual(
      expect.arrayContaining([
        "10.0.0.0/8",
        "172.16.0.0/12",
        "192.168.0.0/16",
        "100.64.0.0/10",
        "169.254.0.0/16",
      ]),
    );
    expect(PRIVATE_V6).toEqual(expect.arrayContaining(["fc00::/7", "fe80::/10"]));
  });

  it("leaves the child's own loopback alone", () => {
    // Deliberate divergence from Windows, and the reason for it: inside the
    // namespace 127.0.0.1 is the child's own loopback and reaches nothing but
    // itself. Windows refuses loopback because there, loopback *is* the host.
    // Blackholing it would break a program that binds a port and talks to it.
    expect(PRIVATE_V4).not.toContain("127.0.0.0/8");
    expect(NETWORK_SETUP).not.toContain("127.0.0.0/8");
  });

  it("flushes the interface rather than deleting the private routes it finds", () => {
    // `pasta --config-net` copies the host's on-link subnet, and on a laptop
    // that subnet *is* the user's LAN: 192.168.1.0/24 beats a 192.168.0.0/16
    // blackhole on longest prefix. A selective delete would leave the LAN
    // reachable on exactly the machines most likely to have one — and would do
    // it in a branch that only runs on somebody else's network.
    expect(NETWORK_SETUP).toContain("ip route flush dev");
    expect(NETWORK_SETUP).toContain("ip route add default dev");
  });

  it("gives the child back the empty PATH the sandbox meant it to have", () => {
    // The script needs `ip`, `sed` and `head`, and a contained child is given an
    // empty PATH on purpose so an MCP server cannot find tools nobody approved.
    // Both are true at once, so the borrow is undone before `exec` — otherwise
    // narrowing the network would quietly widen the toolbox.
    const setup = NETWORK_SETUP.indexOf("PATH=/usr/sbin");
    const restore = NETWORK_SETUP.indexOf("PATH=$_studio_path");
    const exec = NETWORK_SETUP.indexOf('exec "$@"');
    expect(setup).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(setup);
    expect(exec).toBeGreaterThan(restore);
  });

  it("fails closed if a route cannot be added", () => {
    // Without this the child execs with a wider network than the operator
    // agreed to, and nothing anywhere says so.
    expect(NETWORK_SETUP.startsWith("set -eu")).toBe(true);
  });
});

describe("the Linux machine setup, and the fix it refuses to suggest", () => {
  // Pure text, so these run everywhere. What the profile *does* is measured on
  // a Linux machine; what it *says* is checkable here, and the most important
  // assertion in this block is a negative one.

  it("grants the namespace to the binary the resolver actually found", () => {
    // A profile attached to the wrong path silently grants nothing, and setup
    // then reports success while the sandbox stays refused — the worst outcome
    // available, and the reason this is a function of the path rather than a
    // constant with `/usr/bin/bwrap` baked in.
    const text = profileText("/opt/custom/bin/bwrap");
    expect(text).toContain("profile studio-bwrap /opt/custom/bin/bwrap");
    expect(text).toContain("userns,");
  });

  it("never tells the user to lower a kernel setting", () => {
    // The pin that matters. `kernel.apparmor_restrict_unprivileged_userns=0` is
    // one line, it works, and it removes the protection for *every program on
    // the machine* to make one application run. An agent asking its user to
    // weaken their kernel in order to switch a sandbox on is doing the exact
    // thing the sandbox exists to prevent, and it is the first answer any
    // search returns — so it is asserted against rather than merely avoided.
    //
    // Scoped to the instructions, which is what a user is asked to *do*. The
    // first version of this test also covered the profile text and failed on
    // its own comment explaining why the sysctl was rejected — a mention in a
    // rejected-alternative sentence is the opposite of a recommendation, and a
    // test that cannot tell those apart bans the explanation along with the
    // advice.
    const text = elevationInstructions();
    expect(text).not.toMatch(/apparmor_restrict_unprivileged_userns/);
    expect(text).not.toMatch(/unprivileged_userns_clone/);
    expect(text.toLowerCase()).not.toContain("sysctl");
    // It should still say a kernel setting is *not* being lowered, because that
    // is the question a careful reader will have.
    expect(text).toContain("no kernel setting is lowered");
  });

  it("explains the rejected alternative where it will outlive the terminal", () => {
    // The profile file is the durable artefact; the instructions scroll away.
    // Someone auditing `/etc/apparmor.d/` should be able to see both what this
    // grants and what it was chosen over, without finding this repository.
    const text = profileText("/usr/bin/bwrap");
    expect(text).toContain("kernel.apparmor_restrict_unprivileged_userns=0");
    expect(text).toContain("narrower");
  });

  it("tells the user the command, and what it will and will not change", () => {
    const text = elevationInstructions();
    expect(text).toContain("sudo pnpm sandbox:prepare");
    expect(text).toContain(PROFILE_PATH);
    // Reversibility is part of the offer, not a footnote. A machine-wide change
    // with no stated way back is one a careful user is right to refuse.
    expect(text).toContain("--undo");
  });

  it("says what the profile costs, in the profile itself", () => {
    // The file outlives the terminal that printed the instructions. Someone
    // auditing `/etc/apparmor.d/` a year from now should find out what this is
    // and why it is narrower than the alternative, from the file alone.
    const text = profileText("/usr/bin/bwrap");
    expect(text).toContain("Project Studio");
    expect(text).toContain("sandbox:prepare");
    expect(text.toLowerCase()).toContain("every program on the machine");
  });

  describe("who the setup command measures", () => {
    // Found by running `sudo pnpm sandbox:prepare` on Ubuntu 24.04 rather than
    // by reading it. Root holds `CAP_SYS_ADMIN`, so AppArmor's `userns` rule
    // never applies to it and the probe succeeded — the command announced that
    // the sandbox already worked, installed nothing, and exited zero, on a
    // machine where the same `bwrap` command failed for the user one line
    // earlier. A setup command that reports success while the thing stays
    // broken is the precise failure this seam was built to prevent, so the
    // mapping from "who is asking" to "who to ask about" is pinned here.

    it("measures the caller when the caller is not root", () => {
      expect(unprivilegedIdentity(1000, {})).toBeUndefined();
    });

    it("measures the invoking user, not root, under sudo", () => {
      expect(unprivilegedIdentity(0, { SUDO_UID: "1000", SUDO_GID: "1001" }))
        .toEqual({ uid: 1000, gid: 1001 });
    });

    it("falls back to the user's own id when sudo names no group", () => {
      expect(unprivilegedIdentity(0, { SUDO_UID: "1000" }))
        .toEqual({ uid: 1000, gid: 1000 });
    });

    it("never measures root, even with no unprivileged user to name", () => {
      // A real root login has no `SUDO_UID`. Probing as root anyway would bring
      // back the one answer on the machine that cannot be wrong and cannot be
      // useful, so an unprivileged stand-in is used instead — the restriction
      // is attached to the program, so any account without the capability
      // returns the same verdict.
      for (const env of [{}, { SUDO_UID: "0" }, { SUDO_UID: "nonsense" }]) {
        const subject = unprivilegedIdentity(0, env);
        expect(subject).toBeDefined();
        expect(subject?.uid).not.toBe(0);
      }
    });

    it("treats a missing getuid as a caller to measure directly", () => {
      // Windows, where `process.getuid` does not exist. The Linux setup path is
      // never reached there, and the mapping should still not invent a subject.
      expect(unprivilegedIdentity(undefined, {})).toBeUndefined();
    });
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
});

describe("what this build knows how to contain, per platform", () => {
  it("registers a backend exactly where one has been written", () => {
    // Deliberately platform-shaped, and the reason is a distinction worth
    // keeping: *this build has an implementation* is knowledge fixed when the
    // code was written, while *it works on this machine* is `available()`.
    //
    // This assertion is what made step 3 impossible to forget: while Linux had
    // no backend, the branch below asserted an empty registry, so landing
    // `bwrap` failed the test and forced this file, the ADR and the README to
    // be brought along with it. It did exactly that.
    //
    // Windows and macOS are the `else`: Windows had an AppContainer backend
    // until ADR 0057 removed it, macOS never had one by decision. Both assert
    // an empty registry and no enforcement, because on both the gate is the
    // boundary and a build that claimed otherwise would be claiming a fence
    // it does not have.
    if (process.platform === "linux") {
      expect(OS_ISOLATION_BACKENDS.map((entry) => entry.name)).toEqual(["bwrap"]);
      expect(ISOLATION_ENFORCED).toBe(true);
    } else {
      expect(OS_ISOLATION_BACKENDS).toHaveLength(0);
      expect(ISOLATION_ENFORCED).toBe(false);
    }
  });

  it("says why containment is missing, when the backend can say", () => {
    // A refusal that only says "no backend can provide it" is true and leaves
    // the user nowhere to go. This is the same lesson the Windows half learned
    // in reverse: naming the exact folders and the exact command is what turned
    // a dead end into a one-time setup step.
    const mute = backend("mute", false);
    const speaking: IsolationBackend = {
      ...backend("speaking", false),
      diagnose: () => "Install bubblewrap.",
    };

    expect(selectIsolation([mute, speaking]).shortfall).toEqual(["Install bubblewrap."]);
    expect(() => assertIsolationAvailable("os", selectIsolation([mute, speaking])))
      .toThrow(/Install bubblewrap\./);
  });

  it("explains nothing once something works", () => {
    // A second backend that failed is not the user's problem when the first one
    // succeeded, and printing its complaint would be noise attached to a call
    // that is about to run perfectly well.
    const speaking: IsolationBackend = {
      ...backend("speaking", false),
      diagnose: () => "Install bubblewrap.",
    };

    expect(selectIsolation([speaking, backend("works", true)]).shortfall).toEqual([]);
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
