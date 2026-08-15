import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  capabilityKey,
  type CapabilityAuthor,
  type CapabilityDescriptor,
  type CapabilityEffect,
  type ExecutionScope,
} from "../../src/contracts/capabilities.js";
import { PermissionError } from "../../src/permissions/errors.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import {
  PermissionKernel,
  type PermissionApprover,
} from "../../src/permissions/kernel.js";
import { matchesResource } from "../../src/permissions/matcher.js";
import { resourceRule } from "../../src/permissions/policy.js";
import { SandboxError } from "../../src/sandbox/errors.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";
import { ToolError } from "../../src/tools/errors.js";
import { itContained } from "../contained.js";
import { CallGate } from "../../src/tools/gate.js";
import type { SnapshotHook } from "../../src/snapshots/turn.js";
import { defineStudioTool, type ToolDefinition } from "../../src/tools/types.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

function capability(
  name: string,
  effects: CapabilityEffect[],
  author: CapabilityAuthor = "studio",
): CapabilityDescriptor {
  const ours = author === "studio";
  return {
    id: { namespace: ours ? "native" : "mcp:example", name },
    title: name,
    description: name,
    effects,
    provenance: {
      origin: ours ? "native" : "mcp",
      sourceId: ours ? "project-studio" : "example-server",
      author,
    },
    idempotent: true,
  };
}

/** A tool that records whether it ran, so refusals can be proven. */
function readTool(calls: string[]): ToolDefinition<{ path: string }, string> {
  return defineStudioTool({
    descriptor: capability("read", ["read"]),
    resourceKind: "path",
    parse: (input) => {
      const value = input as { path?: unknown };
      if (typeof value.path !== "string") {
        throw new ToolError("invalid_input", { message: "path must be text." });
      }
      return { path: value.path };
    },
    // Resolved through the sandbox, so a rule sees where the call actually
    // lands rather than what the model typed.
    resource: (input, context) => context.sandbox.resolveRead(input.path),
    execute: async (input, context) => {
      calls.push(input.path);
      return context.sandbox.readFile(input.path);
    },
  });
}

function writeTool(calls: string[]): ToolDefinition<{ path: string }, void> {
  return defineStudioTool({
    descriptor: capability("write", ["write"]),
    resourceKind: "path",
    parse: (input) => input as { path: string },
    resource: (input, context) => context.sandbox.resolveWrite(input.path),
    execute: async (input, context) => {
      calls.push(input.path);
      await context.sandbox.writeFile(input.path, "written");
    },
  });
}

function approver(verdict: "allow" | "deny", scopeId?: string): PermissionApprover {
  return {
    request: async () => ({
      verdict,
      duration: "always" as const,
      ...(scopeId !== undefined ? { scopeId } : {}),
    }),
  };
}

let db: StudioDatabase;
let grants: PermissionGrantStore;
let workspace: string;
let sandbox: LocalSandbox;
let calls: string[];

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  grants = new PermissionGrantStore(db);
  workspace = mkdtempSync(join(tmpdir(), "studio-gate-"));
  mkdirSync(join(workspace, "src"), { recursive: true });
  writeFileSync(join(workspace, "src", "app.ts"), "source");
  writeFileSync(join(workspace, "secret.txt"), "secret");
  sandbox = new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace }));
  calls = [];
});

afterEach(() => {
  db.close();
  rmSync(workspace, { recursive: true, force: true });
});

function gate(
  options: {
    approver?: PermissionApprover;
    policy?: never;
    bounds?: ConstructorParameters<typeof CallGate>[0]["bounds"];
    snapshots?: SnapshotHook;
  } = {},
) {
  const kernel = new PermissionKernel({
    grants,
    ...(options.approver ? { approver: options.approver } : {}),
  });
  return new CallGate({
    kernel,
    sandbox,
    ...(options.bounds ? { bounds: options.bounds } : {}),
    ...(options.snapshots ? { snapshots: options.snapshots } : {}),
  });
}

/** Records what the gate asked for a snapshot of, and when. */
function recordingSnapshots(): SnapshotHook & { readonly taken: string[] } {
  const taken: string[] = [];
  return {
    taken,
    beforeWrite: async (resource, kind) => {
      taken.push(`${kind}:${resource ?? "-"}`);
    },
  };
}

/** A tool that runs a program, declared the way `shell` declares itself. */
function executeTool(calls: string[]): ToolDefinition<Record<string, never>, string> {
  return defineStudioTool({
    descriptor: capability("run", ["execute"]),
    resourceKind: "command",
    parse: () => ({}) as Record<string, never>,
    resource: () => "shell:node",
    execute: async () => {
      calls.push("run");
      return "ran";
    },
  });
}

/** A tool that hangs in pure JavaScript, which no subprocess bound catches. */
function hangingTool(): ToolDefinition<Record<string, never>, string> {
  return defineStudioTool({
    descriptor: capability("hang", ["read"]),
    resourceKind: "path",
    parse: () => ({}) as Record<string, never>,
    resource: () => undefined,
    execute: () => new Promise<string>(() => undefined),
  });
}

describe("nothing runs without passing the gate", () => {
  it("refuses a tool that was never registered", async () => {
    const instance = gate();

    await expect(
      instance.call({ name: "native/delete", input: {}, scope: SCOPE }),
    ).rejects.toThrow(ToolError);
  });

  it("registers the capability with the kernel at the same time", async () => {
    // A tool the gate can reach but the kernel has never heard of would be a
    // tool with no decision behind it.
    const instance = gate();
    instance.register(readTool(calls));

    const result = await instance.call({
      name: "native/read",
      input: { path: "src/app.ts" },
      scope: SCOPE,
    });

    expect(result).toBe("source");
  });

  it("refuses two tools under one name", () => {
    const instance = gate();
    instance.register(readTool(calls));

    expect(() => instance.register(readTool(calls))).toThrow(/registered as/i);
  });

  it("does not execute when permission is refused", async () => {
    const instance = gate({ approver: approver("deny") });
    instance.register(writeTool(calls));

    await expect(
      instance.call({ name: "native/write", input: { path: "out.txt" }, scope: SCOPE }),
    ).rejects.toThrow(PermissionError);

    expect(calls).toEqual([]);
  });

  it("does not execute when the argument is rejected", async () => {
    const instance = gate();
    instance.register(readTool(calls));

    await expect(
      instance.call({ name: "native/read", input: { path: 42 }, scope: SCOPE }),
    ).rejects.toThrow(/must be text/i);

    expect(calls).toEqual([]);
  });
});

describe("containment runs before the tool, not inside it", () => {
  it("refuses a path outside the workspace before authorizing", async () => {
    const instance = gate({ approver: approver("allow") });
    instance.register(readTool(calls));

    await expect(
      instance.call({
        name: "native/read",
        input: { path: "../outside.txt" },
        scope: SCOPE,
      }),
    ).rejects.toThrow(SandboxError);

    expect(calls).toEqual([]);
  });

  it("refuses an effect the sandbox will not admit, even when approved", async () => {
    // Permission is not containment, and the gate has to ask both. Approval
    // says the user agreed; the sandbox says we can hold the boundary. An
    // approved call still stops here when the sandbox says no.
    //
    // The condition used to be provenance — a connected server's `execute` was
    // refused outright. ADR 0025 moved that question to `BASE_POLICY`, where it
    // is a policy `ask` no mode can resolve, so the sandbox no longer answers
    // it. The switch is what the sandbox still refuses on, and the property
    // under test here is unchanged: the gate asks, and a refusal stops the call
    // before the tool runs.
    const instance = new CallGate({
      kernel: new PermissionKernel({ grants, approver: approver("allow") }),
      sandbox: new LocalSandbox(
        createSandboxPolicy({ workspaceRoot: workspace, allowExec: false }),
      ),
    });
    instance.register(
      defineStudioTool({
        descriptor: capability("shell", ["execute"], "third-party"),
        resourceKind: "command",
        parse: (input) => input as { command: string },
        resource: (input) => `shell:${input.command}`,
        execute: async () => {
          calls.push("ran");
          return "output";
        },
      }),
    );

    await expect(
      instance.call({
        name: "mcp:example/shell",
        input: { command: "ls" },
        scope: SCOPE,
      }),
    ).rejects.toThrow(SandboxError);

    expect(calls).toEqual([]);
  });
});

describe("permissions see what the call touches", () => {
  it("distinguishes two calls to the same tool by resource", async () => {
    // The gap this closes: without a resource, `git log` and `git push` are one
    // capability and approving either approves both.
    const kernel = new PermissionKernel({
      grants,
      approver: approver("allow"),
      policy: [
        resourceRule({
          id: "no-push",
          capability: "native/git",
          resource: "git:push",
          kind: "command",
          verdict: "deny",
          reason: "Pushing is not allowed here.",
        }),
      ],
    });
    const instance = new CallGate({ kernel, sandbox });
    instance.register(
      defineStudioTool({
        descriptor: capability("git", ["read"]),
        resourceKind: "command",
        parse: (input) => input as { subcommand: string },
        resource: (input) => `git:${input.subcommand}`,
        execute: async (input) => {
          calls.push(input.subcommand);
          return "ok";
        },
      }),
    );

    await instance.call({
      name: "native/git",
      input: { subcommand: "log" },
      scope: SCOPE,
    });
    await expect(
      instance.call({ name: "native/git", input: { subcommand: "push" }, scope: SCOPE }),
    ).rejects.toThrow(PermissionError);

    expect(calls).toEqual(["log"]);
  });

  it("stores an approval narrowed to the scope the user chose", async () => {
    // The user picks "this folder"; the pattern is ours to derive, so no dialog
    // can store something wider than the option it displayed.
    const instance = gate({ approver: approver("allow", "this-folder") });
    instance.register(writeTool(calls));

    await instance.call({
      name: "native/write",
      input: { path: "src/one.ts" },
      scope: SCOPE,
    });

    const [stored] = grants.list();
    expect(stored?.resourcePattern).toBe(
      join(workspace, "src", "**").replaceAll("\\", "/"),
    );
  });

  it("defaults to the narrowest scope when the approver names none", async () => {
    const instance = gate({ approver: approver("allow") });
    instance.register(writeTool(calls));

    await instance.call({
      name: "native/write",
      input: { path: "src/one.ts" },
      scope: SCOPE,
    });

    const [stored] = grants.list();
    expect(stored?.resourcePattern).toBe(join(workspace, "src", "one.ts"));
  });

  it("narrows rather than widens when the approver names a scope we never offered", async () => {
    // A broken UI must degrade into asking too often, never into granting too
    // much.
    const instance = gate({ approver: approver("allow", "everything-everywhere") });
    instance.register(writeTool(calls));

    await instance.call({
      name: "native/write",
      input: { path: "src/one.ts" },
      scope: SCOPE,
    });

    const [stored] = grants.list();
    expect(stored?.resourcePattern).toBe(join(workspace, "src", "one.ts"));
  });

  it("reuses a narrowed grant inside its pattern and asks again outside it", async () => {
    let prompts = 0;
    const kernel = new PermissionKernel({
      grants,
      approver: {
        request: async () => {
          prompts += 1;
          return {
            verdict: "allow" as const,
            duration: "always" as const,
            scopeId: "this-folder",
          };
        },
      },
    });
    const instance = new CallGate({ kernel, sandbox });
    instance.register(writeTool(calls));

    await instance.call({ name: "native/write", input: { path: "src/a.ts" }, scope: SCOPE });
    await instance.call({ name: "native/write", input: { path: "src/b.ts" }, scope: SCOPE });
    expect(prompts).toBe(1);

    // Outside the approved pattern the grant must not apply, or "allow edits in
    // src" would silently have meant "allow edits anywhere".
    await instance.call({ name: "native/write", input: { path: "root.ts" }, scope: SCOPE });
    expect(prompts).toBe(2);
  });
});

describe("the gate bounds the call, not just the subprocess", () => {
  it("gives up on a tool that hangs in pure JavaScript", async () => {
    const instance = gate({ bounds: { timeoutMs: 40 } });
    instance.register(hangingTool());

    const error = await instance
      .call({ name: "native/hang", input: {}, scope: SCOPE })
      .then(() => undefined)
      .catch((thrown: unknown) => thrown as ToolError);

    expect(error).toBeInstanceOf(ToolError);
    expect(error?.kind).toBe("timed_out");
  });

  it("does not put a waiting approval under the deadline", async () => {
    // A person thinking is not a call running slowly. If approval were inside
    // the bound, a user who paused would have their call cancelled for it.
    const instance = gate({
      bounds: { timeoutMs: 60 },
      approver: {
        request: async () => {
          await new Promise((resolve) => setTimeout(resolve, 120));
          return { verdict: "allow" as const, duration: "always" as const };
        },
      },
    });
    instance.register(readTool(calls));

    await expect(
      instance.call({ name: "native/read", input: { path: "src/app.ts" }, scope: SCOPE }),
    ).resolves.toBe("source");
  });

  it("reports nothing in flight once a bounded call has ended", async () => {
    const instance = gate({ bounds: { timeoutMs: 40, maxConcurrent: 1 } });
    instance.register(hangingTool());

    await instance
      .call({ name: "native/hang", input: {}, scope: SCOPE })
      .catch(() => undefined);

    expect(instance.inFlight).toEqual({ active: 0, queued: 0 });
  });
});

describe("resource patterns", () => {
  it("distinguishes one level from all levels", () => {
    expect(matchesResource("src/*", "src/app.ts", "path")).toBe(true);
    expect(matchesResource("src/*", "src/deep/app.ts", "path")).toBe(false);
    expect(matchesResource("src/**", "src/deep/app.ts", "path")).toBe(true);
    expect(matchesResource("src/**", "src", "path")).toBe(true);
  });

  it("matches a command without treating it as a path", () => {
    expect(matchesResource("git:*", "git:push", "command")).toBe(true);
    expect(matchesResource("git:log", "git:push", "command")).toBe(false);
  });

  it("treats an absent pattern as covering the whole capability", () => {
    // What every grant meant before resources existed.
    expect(matchesResource(undefined, "anything", "path")).toBe(true);
  });

  it("does not let an unscoped call satisfy a scoped rule", () => {
    expect(matchesResource("src/**", undefined, "path")).toBe(false);
  });

  it.runIf(process.platform === "win32")("compares case-insensitively on Windows", () => {
    // `SRC/A.TS` and `src/a.ts` are the same file here; a case-sensitive rule
    // would be evaded by changing the spelling.
    expect(matchesResource("src/**", "SRC/App.ts", "path")).toBe(true);
  });

  it("accepts either slash on Windows paths", () => {
    expect(matchesResource("src/**", "src\\deep\\app.ts", "path")).toBe(true);
  });
});

describe("the model is shown only what can actually run", () => {
  // T-28. `list()` and `assertSupports` used to answer different questions, so
  // a switched-off capability still appeared in the prompt: the model called
  // it, was refused, and the schema was billed on every turn for the privilege.

  function gateWith(allowExec: boolean): CallGate {
    return new CallGate({
      kernel: new PermissionKernel({ grants }),
      sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace, allowExec })),
    });
  }

  it("hides a capability the policy switched off", () => {
    const locked = gateWith(false);
    locked.register(executeTool([]));
    locked.register(readTool([]));

    expect(locked.list().map((tool) => tool.id.name)).toEqual(["read"]);
  });

  // `itContained`: `list()` shows only what could actually run, and an
  // execute-capable tool cannot on a host with no working sandbox. The
  // switched-off case above needs no such gate — it is hidden for a policy
  // reason on every machine.
  itContained("shows it when the policy allows it", () => {
    const open = gateWith(true);
    open.register(executeTool([]));

    expect(open.list().map((tool) => tool.id.name)).toEqual(["run"]);
  });

  it("still lists it for a settings screen, which has to offer switching it on", () => {
    const locked = gateWith(false);
    locked.register(executeTool([]));

    expect(locked.list()).toHaveLength(0);
    expect(locked.listAll().map((tool) => tool.id.name)).toEqual(["run"]);
  });

  it("reports a withheld capability and switch once while listing", () => {
    const withheld: { capability: string; switchName: string }[] = [];
    const locked = new CallGate({
      kernel: new PermissionKernel({ grants }),
      sandbox: new LocalSandbox(
        createSandboxPolicy({ workspaceRoot: workspace, allowExec: false }),
      ),
      onWithheld: (event) => withheld.push(event),
    });
    locked.register(executeTool([]));

    expect(locked.list()).toEqual([]);
    expect(locked.list()).toEqual([]);
    expect(withheld).toEqual([{ capability: "native/run", switchName: "allowExec" }]);
    expect(locked.listAll().map((tool) => tool.id.name)).toEqual(["run"]);
  });

  itContained("does not hide a tool merely because it has not been approved", () => {
    // "You have not approved this yet" is a question with an answer. Hiding the
    // tool would take away the user's chance to give it.
    const instance = gate();
    instance.register(executeTool([]));

    expect(instance.list().map((tool) => tool.id.name)).toContain("run");
  });
});

describe("a restore point is taken from the effect table, not from a list of names", () => {
  it("takes one before a write", async () => {
    const snapshots = recordingSnapshots();
    const instance = gate({ approver: approver("allow"), snapshots });
    instance.register(writeTool(calls));

    await instance.call({ name: "native/write", input: { path: "new.txt" }, scope: SCOPE });

    expect(snapshots.taken).toHaveLength(1);
  });

  // T-14. `shell` declares execute and writes anyway, and the gate used to
  // test `effects.includes("write")` — so the tool that can do the most damage
  // was the one with nothing to return to.
  itContained("takes one before a program runs", async () => {
    const snapshots = recordingSnapshots();
    // A policy that permits running programs, which is the only state in which
    // this question arises at all.
    sandbox = new LocalSandbox(
      createSandboxPolicy({ workspaceRoot: workspace, allowExec: true }),
    );
    const instance = gate({ approver: approver("allow"), snapshots });
    instance.register(executeTool(calls));

    await instance.call({ name: "native/run", input: {}, scope: SCOPE });

    expect(calls).toStrictEqual(["run"]);
    expect(snapshots.taken).toStrictEqual(["command:shell:node"]);
  });

  it("takes none before a read", async () => {
    const snapshots = recordingSnapshots();
    const instance = gate({ snapshots });
    instance.register(readTool(calls));

    await instance.call({
      name: "native/read",
      input: { path: "src/app.ts" },
      scope: SCOPE,
    });

    expect(snapshots.taken).toStrictEqual([]);
  });

  it("takes none when the call is refused", async () => {
    const snapshots = recordingSnapshots();
    const instance = gate({ approver: approver("deny"), snapshots });
    instance.register(writeTool(calls));

    await expect(
      instance.call({ name: "native/write", input: { path: "new.txt" }, scope: SCOPE }),
    ).rejects.toBeInstanceOf(PermissionError);

    expect(snapshots.taken).toStrictEqual([]);
  });
});

describe("a tool states its own deadline", () => {
  it("uses the tool's deadline over the shared default", () => {
    // T-15. `shell` allowed ten minutes while the gate abandoned every call at
    // two, so the longer limit was never reachable.
    const instance = gate();
    const descriptor = capability("slow", ["read"]);
    instance.register({
      ...readTool(calls),
      descriptor,
      deadlineMs: 600_000,
    } as unknown as ToolDefinition<{ path: string }, string>);

    expect(instance.deadlineFor(descriptor)).toBe(600_000);
  });

  it("lets an operator's limit win over the tool's", () => {
    // Whoever runs the harness has the last word. A tool asking for more must
    // not quietly overrule a limit somebody set on purpose.
    const instance = gate({ bounds: { timeoutByCapability: { "native/slow": 5_000 } } });
    const descriptor = capability("slow", ["read"]);
    instance.register({
      ...readTool(calls),
      descriptor,
      deadlineMs: 600_000,
    } as unknown as ToolDefinition<{ path: string }, string>);

    expect(instance.deadlineFor(descriptor)).toBe(5_000);
  });

  it("falls back to the shared default when a tool says nothing", () => {
    const instance = gate({ bounds: { timeoutMs: 30_000 } });
    instance.register(readTool(calls));

    expect(instance.deadlineFor(capability("read", ["read"]))).toBe(30_000);
  });
});

describe("a tool can be taken away again", () => {
  /** A tool from a named provider, so a whole source can be removed at once. */
  function serverTool(
    name: string,
    calls: string[],
  ): ToolDefinition<{ path: string }, string> {
    return defineStudioTool({
      descriptor: {
        ...capability(name, ["read"], "third-party"),
        provenance: {
          origin: "mcp",
          sourceId: "blender",
          author: "third-party",
        },
      },
      resourceKind: "path",
      parse: (input) => input as { path: string },
      resource: (input) => input.path,
      execute: async () => {
        calls.push(name);
        return "ran";
      },
    });
  }

  it("stops offering a tool once it is unregistered", () => {
    const instance = gate();
    instance.register(readTool(calls));

    expect(instance.unregister({ namespace: "native", name: "read" })).toBe(true);
    expect(instance.list()).toEqual([]);
    expect(instance.listAll()).toEqual([]);
  });

  it("refuses a call to a tool that has been removed", async () => {
    const instance = gate({ approver: approver("allow") });
    instance.register(readTool(calls));
    instance.unregister({ namespace: "native", name: "read" });

    await expect(
      instance.call({ name: "native/read", input: { path: "a.txt" }, scope: SCOPE }),
    ).rejects.toThrow(/no tool named/i);
    expect(calls).toEqual([]);
  });

  it("takes the kernel with it, so nothing is decidable that is not callable", () => {
    // The pair `register` keeps together has to come apart together too. A
    // capability the kernel still knows is one a stale grant could still match.
    const kernel = new PermissionKernel({ grants });
    const instance = new CallGate({ kernel, sandbox });
    instance.register(readTool(calls));

    expect(kernel.get({ namespace: "native", name: "read" })).toBeDefined();

    instance.unregister({ namespace: "native", name: "read" });

    expect(kernel.get({ namespace: "native", name: "read" })).toBeUndefined();
  });

  it("reports whether anything was actually removed", () => {
    const instance = gate();

    expect(instance.unregister({ namespace: "native", name: "read" })).toBe(false);
  });

  it("allows registering the same key again afterwards, which is the reload path", () => {
    const instance = gate();
    instance.register(readTool(calls));
    instance.unregister({ namespace: "native", name: "read" });

    expect(() => instance.register(readTool(calls))).not.toThrow();
    expect(instance.listAll()).toHaveLength(1);
  });

  it("still refuses a duplicate, because reload is explicit and a collision is not", () => {
    const instance = gate();
    instance.register(readTool(calls));

    expect(() => instance.register(readTool(calls))).toThrow(ToolError);
  });

  it("drops the tool's declared deadline, so its successor does not inherit it", () => {
    // A five-minute deadline left behind would be handed to whatever registers
    // that key next, which never asked for it.
    const instance = gate();
    const descriptor = capability("slow", ["read"]);
    instance.register({
      ...readTool(calls),
      descriptor,
      deadlineMs: 600_000,
    } as unknown as ToolDefinition<{ path: string }, string>);

    expect(instance.deadlineFor(descriptor)).toBe(600_000);

    instance.unregister(descriptor.id);
    instance.register({ ...readTool(calls), descriptor } as unknown as ToolDefinition<
      { path: string },
      string
    >);

    expect(instance.deadlineFor(descriptor)).not.toBe(600_000);
  });

  it("removes every tool one provider contributed, and only those", () => {
    const instance = gate();
    instance.register(readTool(calls));
    instance.register(serverTool("render", calls));
    instance.register(serverTool("export", calls));

    expect(instance.unregisterSource("blender")).toBe(2);
    expect(instance.listAll().map((d) => capabilityKey(d.id))).toEqual(["native/read"]);
  });

  it("lets a call that already started finish", async () => {
    // Removing a tool stops the next call, not the one in progress. Waiting for
    // in-flight work belongs to whatever is being torn down.
    const instance = gate({ approver: approver("allow") });
    let release!: () => void;
    const started = new Promise<void>((resolve) => {
      release = resolve;
    });

    instance.register(
      defineStudioTool({
        descriptor: capability("slow", ["read"]),
        resourceKind: "path",
        parse: (input) => input as { path: string },
        resource: (input) => input.path,
        execute: async () => {
          await started;
          calls.push("finished");
          return "done";
        },
      }),
    );

    const inFlight = instance.call({
      name: "native/slow",
      input: { path: "a.txt" },
      scope: SCOPE,
    });

    expect(instance.unregister({ namespace: "native", name: "slow" })).toBe(true);
    release();

    await expect(inFlight).resolves.toBe("done");
    expect(calls).toEqual(["finished"]);
  });
});
