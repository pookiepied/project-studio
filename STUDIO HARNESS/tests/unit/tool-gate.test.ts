import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  CapabilityDescriptor,
  CapabilityEffect,
  ExecutionScope,
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
import { CallGate } from "../../src/tools/gate.js";
import { defineStudioTool, type ToolDefinition } from "../../src/tools/types.js";

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

function capability(
  name: string,
  effects: CapabilityEffect[],
  trusted = true,
): CapabilityDescriptor {
  return {
    id: { namespace: trusted ? "native" : "mcp:example", name },
    title: name,
    description: name,
    effects,
    provenance: {
      origin: trusted ? "native" : "mcp",
      sourceId: trusted ? "project-studio" : "example-server",
      trusted,
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

  it("refuses an effect the sandbox cannot contain, even when approved", async () => {
    // Permission is not isolation. An approved `execute` still fails in an
    // in-process sandbox, because approval does not create a boundary.
    const instance = gate({ approver: approver("allow") });
    instance.register(
      defineStudioTool({
        descriptor: capability("shell", ["execute"]),
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
        name: "native/shell",
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
