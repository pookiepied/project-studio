import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  CapabilityAuthor,
  CapabilityDescriptor,
  CapabilityEffect,
  ExecutionScope,
} from "../../src/contracts/capabilities.js";
import { hashDefinition } from "../../src/extend/mcp/wire/definition-hash.js";
import { PermissionError } from "../../src/permissions/errors.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import {
  PermissionKernel,
  type PermissionApprover,
} from "../../src/permissions/kernel.js";
import type { GrantDuration } from "../../src/permissions/policy.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

function capability(
  name: string,
  effects: CapabilityEffect[],
  options: {
    author?: CapabilityAuthor;
    description?: string;
    inputSchema?: unknown;
    namespace?: string;
  } = {},
): CapabilityDescriptor {
  const ours = (options.author ?? "studio") === "studio";
  return {
    id: { namespace: options.namespace ?? (ours ? "native" : "mcp:example"), name },
    title: name,
    description: options.description ?? name,
    effects,
    provenance: {
      origin: ours ? "native" : "mcp",
      sourceId: ours ? "project-studio" : "example-server",
      author: options.author ?? "studio",
    },
    idempotent: true,
    ...(options.inputSchema === undefined ? {} : { inputSchema: options.inputSchema }),
  };
}

const SCOPE: ExecutionScope = {
  conversationId: "conv-1",
  projectId: "proj-1",
  agentId: "studio",
};

function approver(
  verdict: "allow" | "deny",
  duration: GrantDuration = "always",
): PermissionApprover {
  return { request: async () => ({ verdict, duration }) };
}

let db: StudioDatabase;
let grants: PermissionGrantStore;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  grants = new PermissionGrantStore(db);
});

afterEach(() => {
  db.close();
});

describe("the kernel is the only source of permission", () => {
  it("denies an unregistered capability rather than asking about it", () => {
    // There is no honest prompt to show for something whose effects are
    // unknown, so this must not degrade into "ask".
    const kernel = new PermissionKernel({ grants });

    const decision = kernel.evaluate(
      { namespace: "native", name: "ghost" },
      SCOPE,
    );

    expect(decision.verdict).toBe("deny");
    expect(decision.source).toBe("policy");
  });

  it("allows a trusted read-only capability by default", () => {
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("read_file", ["read"]));

    const decision = kernel.evaluate({ namespace: "native", name: "read_file" }, SCOPE);
    expect(decision.verdict).toBe("allow");
    expect(decision.source).toBe("default");
  });

  it("asks before anything that writes, executes, or reaches the network", () => {
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("write_file", ["write"]));
    kernel.register(capability("run", ["execute"]));
    kernel.register(capability("fetch", ["network"]));

    for (const name of ["write_file", "run", "fetch"]) {
      expect(kernel.evaluate({ namespace: "native", name }, SCOPE).verdict).toBe("ask");
    }
  });

  it("does not trust a connected server's description of itself", () => {
    // An MCP server declaring a read-only tool does not thereby become
    // trusted; provenance decides, not self-description.
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("search", ["read"], { author: "third-party" }));

    expect(
      kernel.evaluate({ namespace: "mcp:example", name: "search" }, SCOPE).verdict,
    ).toBe("ask");
  });

  it("refuses a collision instead of letting one provider shadow another", () => {
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("read_file", ["read"]));

    expect(() =>
      kernel.register({
        ...capability("read_file", ["read"]),
        provenance: { origin: "mcp", sourceId: "impostor", author: "third-party" },
      }),
    ).toThrow(PermissionError);
  });

  it("refuses a capability that declares no effects", () => {
    // Declaring nothing was the most permissive thing a capability could do:
    // every "do all of its effects allow this?" question is true for nothing,
    // so it read as read-only, untrusted-safe, and auto-allowed.
    const kernel = new PermissionKernel({ grants });

    expect(() => kernel.register(capability("empty", []))).toThrow(PermissionError);
    expect(() => kernel.register(capability("empty", []))).toThrow(/no effects/i);
  });

  it("refuses two ids that would collapse into one key", () => {
    // `capabilityKey` joins with an unescaped "/", so a server naming its tool
    // "b/c" under "mcp:a" lands on the key that "mcp:a/b" + "c" already owns —
    // and grants, policy rules and audit lines are all keyed by that string.
    const kernel = new PermissionKernel({ grants });

    // Both spellings are refused, so neither can be the one that gets there
    // first and owns the key.
    expect(() =>
      kernel.register(capability("c", ["read"], { namespace: "mcp:a/b", author: "third-party" })),
    ).toThrow(/must not contain/i);
    expect(() =>
      kernel.register(capability("b/c", ["read"], { namespace: "mcp:a", author: "third-party" })),
    ).toThrow(/must not contain/i);
    expect(kernel.list()).toHaveLength(0);
  });

  it("refuses a capability with an empty namespace or name", () => {
    const kernel = new PermissionKernel({ grants });

    expect(() => kernel.register(capability("", ["read"]))).toThrow(/must not be empty/i);
    expect(() =>
      kernel.register(capability("thing", ["read"], { namespace: "   " })),
    ).toThrow(/must not be empty/i);
  });
});

describe("authority comes from the application, never the model", () => {
  it("rejects a call with no agent identity", () => {
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("read_file", ["read"]));

    expect(() =>
      kernel.evaluate({ namespace: "native", name: "read_file" }, {
        ...SCOPE,
        agentId: "",
      }),
    ).toThrow(/scope/i);
  });

  it("rejects a call with no conversation identity", () => {
    // A blank id would collapse distinct scopes into one bucket, so a grant
    // given in one conversation would apply everywhere.
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("read_file", ["read"]));

    expect(() =>
      kernel.evaluate({ namespace: "native", name: "read_file" }, {
        ...SCOPE,
        conversationId: "   ",
      }),
    ).toThrow(PermissionError);
  });
});

describe("grants", () => {
  it("stores a tool definition and asks again when the definition changes", async () => {
    let prompts = 0;
    const promptReasons: string[] = [];
    const kernel = new PermissionKernel({
      grants,
      approver: {
        request: async (_request, decision) => {
          prompts += 1;
          promptReasons.push(decision.reason);
          return { verdict: "allow" as const, duration: "always" as const };
        },
      },
    });
    const id = { namespace: "mcp:example", name: "search" } as const;
    const firstSchema = {
      type: "object",
      properties: { query: { type: "string" } },
    };
    const first = capability("search", ["execute"], {
      author: "third-party",
      description: "Search the docs",
      inputSchema: firstSchema,
    });

    kernel.register(first);
    await kernel.authorize(id, SCOPE);

    expect(grants.list()[0]?.definitionHash).toBe(
      hashDefinition("search", "Search the docs", firstSchema),
    );

    kernel.unregister(id);
    const secondSchema = {
      type: "object",
      properties: { query: { type: "string" }, limit: { type: "number" } },
    };
    kernel.register(
      capability("search", ["execute"], {
        author: "third-party",
        description: "Search the docs",
        inputSchema: secondSchema,
      }),
    );

    const changed = kernel.evaluate(id, SCOPE);
    expect(changed.verdict).toBe("ask");
    expect(changed.reason).toMatch(/definition changed/i);

    await kernel.authorize(id, SCOPE);

    expect(prompts).toBe(2);
    expect(promptReasons[1]).toMatch(/definition changed/i);
    expect(grants.list()[0]?.definitionHash).toBe(
      hashDefinition("search", "Search the docs", secondSchema),
    );
    expect(kernel.evaluate(id, SCOPE).verdict).toBe("allow");
  });

  it("remembers an approval so the user is asked once, not every call", async () => {
    const kernel = new PermissionKernel({ grants, approver: approver("allow") });
    kernel.register(capability("write_file", ["write"]));
    const id = { namespace: "native", name: "write_file" } as const;

    expect(kernel.evaluate(id, SCOPE).verdict).toBe("ask");
    await kernel.authorize(id, SCOPE);

    const after = kernel.evaluate(id, SCOPE);
    expect(after.verdict).toBe("allow");
    expect(after.source).toBe("grant");
  });

  it("stores an always approval as a conversation grant when the conversation has no project", async () => {
    // A conversation with no project carries a project key derived from its
    // own folder, so a standing grant there could reach no other
    // conversation anyway. Stored as this conversation's, it holds exactly as
    // long and goes with the conversation instead of outliving it.
    const kernel = new PermissionKernel({ grants, approver: approver("allow", "always") });
    kernel.register(capability("write_file", ["write"]));
    const id = { namespace: "native", name: "write_file" } as const;
    const standalone: ExecutionScope = { ...SCOPE, projectId: "workspace-abc123", standalone: true };

    await kernel.authorize(id, standalone);

    const [stored] = grants.list();
    expect(stored?.conversationId).toBe(standalone.conversationId);
    expect(kernel.evaluate(id, standalone).verdict).toBe("allow");
    // A project conversation keeps its always as a standing grant.
    await kernel.authorize(id, SCOPE);
    expect(grants.list().some((row) => row.conversationId === undefined)).toBe(true);
  });

  it("stores nothing for a once-only approval", async () => {
    const kernel = new PermissionKernel({
      grants,
      approver: approver("allow", "once"),
    });
    kernel.register(capability("write_file", ["write"]));
    const id = { namespace: "native", name: "write_file" } as const;

    await kernel.authorize(id, SCOPE);

    expect(grants.list()).toEqual([]);
    expect(kernel.evaluate(id, SCOPE).verdict).toBe("ask");
  });

  it("keeps a conversation-scoped grant out of other conversations", async () => {
    const kernel = new PermissionKernel({
      grants,
      approver: approver("allow", "conversation"),
    });
    kernel.register(capability("write_file", ["write"]));
    const id = { namespace: "native", name: "write_file" } as const;

    await kernel.authorize(id, SCOPE);

    expect(kernel.evaluate(id, SCOPE).verdict).toBe("allow");
    expect(
      kernel.evaluate(id, { ...SCOPE, conversationId: "conv-2" }).verdict,
    ).toBe("ask");
  });

  it("keeps an always-grant out of another project", async () => {
    // `project_id` was written on every row and never read, so "always allow"
    // approved in one repository applied in every other one. Path grants hid
    // it, because the stored pattern is an absolute path under the old root.
    const kernel = new PermissionKernel({ grants, approver: approver("allow") });
    kernel.register(capability("git", ["read", "write"]));
    const id = { namespace: "native", name: "git" } as const;
    const call = { resource: "git:push", kind: "command" } as const;

    await kernel.authorize(id, SCOPE, call);

    expect(kernel.evaluate(id, SCOPE, call).verdict).toBe("allow");
    expect(
      kernel.evaluate(id, { ...SCOPE, projectId: "proj-2" }, call).verdict,
    ).toBe("ask");
  });

  it("lets the same approval be given again in a second project", async () => {
    // The uniqueness rule had to follow the query. Without `project_id` in the
    // index the second approval collides with the first and is refused.
    const kernel = new PermissionKernel({ grants, approver: approver("allow") });
    kernel.register(capability("git", ["read", "write"]));
    const id = { namespace: "native", name: "git" } as const;
    const call = { resource: "git:push", kind: "command" } as const;
    const other = { ...SCOPE, projectId: "proj-2" };

    await kernel.authorize(id, SCOPE, call);
    await kernel.authorize(id, other, call);

    expect(kernel.evaluate(id, other, call).verdict).toBe("allow");
    expect(grants.list()).toHaveLength(2);
  });

  it("does not let one agent inherit another's grant", async () => {
    // A subagent runs under its own identity precisely so this cannot happen.
    const kernel = new PermissionKernel({ grants, approver: approver("allow") });
    kernel.register(capability("write_file", ["write"]));
    const id = { namespace: "native", name: "write_file" } as const;

    await kernel.authorize(id, SCOPE);

    expect(kernel.evaluate(id, { ...SCOPE, agentId: "researcher" }).verdict).toBe(
      "ask",
    );
  });

  it("makes a revoked grant stop authorizing immediately", async () => {
    const kernel = new PermissionKernel({ grants, approver: approver("allow") });
    kernel.register(capability("write_file", ["write"]));
    const id = { namespace: "native", name: "write_file" } as const;

    const decision = await kernel.authorize(id, SCOPE);
    expect(grants.revoke(decision.grantId as string)).toBe(true);

    expect(kernel.evaluate(id, SCOPE).verdict).toBe("ask");
  });

  it("treats approving the same thing twice as a no-op", async () => {
    const kernel = new PermissionKernel({ grants, approver: approver("allow") });
    kernel.register(capability("write_file", ["write"]));
    const id = { namespace: "native", name: "write_file" } as const;

    await kernel.authorize(id, SCOPE);
    await kernel.authorize(id, SCOPE);

    expect(grants.list()).toHaveLength(1);
  });

  it("drops conversation grants when the conversation ends", async () => {
    const kernel = new PermissionKernel({
      grants,
      approver: approver("allow", "conversation"),
    });
    kernel.register(capability("write_file", ["write"]));
    const id = { namespace: "native", name: "write_file" } as const;

    await kernel.authorize(id, SCOPE);
    expect(grants.revokeConversation("conv-1")).toBe(1);

    expect(kernel.evaluate(id, SCOPE).verdict).toBe("ask");
  });

  it("lists grants so the user can see and revoke them", async () => {
    const kernel = new PermissionKernel({ grants, approver: approver("allow") });
    kernel.register(capability("write_file", ["write"]));

    await kernel.authorize({ namespace: "native", name: "write_file" }, SCOPE);

    expect(grants.list()).toHaveLength(1);
    expect(grants.list({ agentId: "studio" })).toHaveLength(1);
    expect(grants.list({ agentId: "someone-else" })).toEqual([]);
  });
});

describe("a grant can never overturn policy", () => {
  it("keeps refusing an unregistered capability even with a grant recorded", () => {
    const kernel = new PermissionKernel({ grants });
    grants.grant({ namespace: "native", name: "ghost" }, SCOPE, "always");

    expect(
      kernel.evaluate({ namespace: "native", name: "ghost" }, SCOPE).verdict,
    ).toBe("deny");
  });

  it("honors a hard policy deny over a stored approval", () => {
    const kernel = new PermissionKernel({
      grants,
      policy: [
        {
          id: "never",
          reason: "Never allowed.",
          evaluate: () => "deny",
        },
      ],
    });
    kernel.register(capability("write_file", ["write"]));
    grants.grant({ namespace: "native", name: "write_file" }, SCOPE, "always");

    const decision = kernel.evaluate({ namespace: "native", name: "write_file" }, SCOPE);
    expect(decision.verdict).toBe("deny");
    expect(decision.source).toBe("policy");
  });
});

describe("authorize", () => {
  it("returns only when execution is actually permitted", async () => {
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("read_file", ["read"]));

    const decision = await kernel.authorize(
      { namespace: "native", name: "read_file" },
      SCOPE,
    );
    expect(decision.verdict).toBe("allow");
  });

  it("raises rather than proceeding when there is no approver", async () => {
    // An unattended run must not become a silent grant of everything it asks
    // for.
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("run", ["execute"]));

    await expect(
      kernel.authorize({ namespace: "native", name: "run" }, SCOPE),
    ).rejects.toThrow(PermissionError);
  });

  it("raises when the user declines", async () => {
    const kernel = new PermissionKernel({ grants, approver: approver("deny") });
    kernel.register(capability("run", ["execute"]));

    await expect(
      kernel.authorize({ namespace: "native", name: "run" }, SCOPE),
    ).rejects.toThrow(/declined/i);
  });

  it("cancels an approval wait without writing a grant", async () => {
    const controller = new AbortController();
    const kernel = new PermissionKernel({
      grants,
      approver: {
        request: async (_request, _decision, signal) =>
          new Promise((resolve) => {
            signal?.addEventListener("abort", () => resolve(undefined), { once: true });
          }),
      },
    });
    const id = { namespace: "native", name: "run" } as const;
    kernel.register(capability("run", ["execute"]));

    const pending = kernel.authorize(id, SCOPE, undefined, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(pending).rejects.toMatchObject({ kind: "cancelled" });
    expect(grants.find(id, SCOPE, undefined, "path")).toBeUndefined();
  });

  it("never carries call arguments in the refusal", async () => {
    const kernel = new PermissionKernel({ grants, approver: approver("deny") });
    kernel.register(capability("run", ["execute"]));

    let error: PermissionError | undefined;
    try {
      await kernel.authorize({ namespace: "native", name: "run" }, SCOPE);
    } catch (caught) {
      error = caught as PermissionError;
    }

    expect(error?.toReport()).not.toHaveProperty("arguments");
    expect(error?.capability).toBe("native/run");
    expect(error?.code).toBe("permissions.denied");
  });
});

describe("a capability can be forgotten again", () => {
  it("refuses a duplicate from the same provider too", () => {
    // This used to be treated as an update and allowed through. Two native
    // tools share one `sourceId`, so the lenient rule silently swallowed the
    // collision it looked like it was catching. Reload goes through
    // `unregister`, which cannot happen by accident.
    const kernel = new PermissionKernel({ grants });
    kernel.register(capability("read_file", ["read"]));

    expect(() => kernel.register(capability("read_file", ["read"]))).toThrow(
      /already registered/i,
    );
  });

  it("stops deciding about a capability once it is unregistered", () => {
    const kernel = new PermissionKernel({ grants });
    const id = { namespace: "native", name: "read_file" };
    kernel.register(capability("read_file", ["read"]));

    expect(kernel.unregister(id)).toBe(true);
    expect(kernel.get(id)).toBeUndefined();
    expect(kernel.list()).toEqual([]);
    expect(kernel.evaluate(id, SCOPE).verdict).toBe("deny");
  });

  it("reports whether anything was removed", () => {
    const kernel = new PermissionKernel({ grants });

    expect(kernel.unregister({ namespace: "native", name: "absent" })).toBe(false);
  });

  it("leaves grants alone, because unregistering is not revoking", () => {
    // A server switched off for one project keeps its approvals for the others.
    // Which events revoke is decided in one place, and it is not this one.
    const kernel = new PermissionKernel({ grants });
    const id = { namespace: "mcp:example", name: "search" };
    kernel.register(capability("search", ["read"], { author: "third-party" }));

    grants.grant(id, SCOPE, "always");
    expect(grants.find(id, SCOPE)).toBeDefined();

    kernel.unregister(id);

    expect(grants.find(id, SCOPE)).toBeDefined();
  });
});

describe("an extension takes its approvals with it", () => {
  // The other half of the sentence above. Unregistering is not revoking;
  // removing the thing itself is. These are the events that revoke.

  it("revokes every grant a namespace holds", () => {
    const render = { namespace: "mcp:blender", name: "render" };
    const scene = { namespace: "mcp:blender", name: "scene" };

    grants.grant(render, SCOPE, "always");
    grants.grant(scene, SCOPE, "always");

    expect(grants.revokeNamespace("mcp:blender")).toBe(2);

    expect(grants.find(render, SCOPE)).toBeUndefined();
    expect(grants.find(scene, SCOPE)).toBeUndefined();
  });

  it("leaves every other namespace alone", () => {
    const mine = { namespace: "mcp:blender", name: "render" };
    const other = { namespace: "mcp:figma", name: "render" };
    const native = { namespace: "native", name: "read_file" };

    grants.grant(mine, SCOPE, "always");
    grants.grant(other, SCOPE, "always");
    grants.grant(native, SCOPE, "always");

    grants.revokeNamespace("mcp:blender");

    expect(grants.find(other, SCOPE)).toBeDefined();
    expect(grants.find(native, SCOPE)).toBeDefined();
  });

  it("does not treat a namespace as a pattern", () => {
    // `_` and `%` are wildcards to LIKE, and a namespace is user-influenced
    // text. Revoking `mcp:a_b` must not reach `mcp:axb`, which is a different
    // server the user never touched.
    const underscore = { namespace: "mcp:a_b", name: "run" };
    const wildcarded = { namespace: "mcp:axb", name: "run" };

    grants.grant(underscore, SCOPE, "always");
    grants.grant(wildcarded, SCOPE, "always");

    expect(grants.revokeNamespace("mcp:a_b")).toBe(1);
    expect(grants.find(wildcarded, SCOPE)).toBeDefined();
  });

  it("does not revoke a namespace that merely starts the same", () => {
    // `mcp:blender` and `mcp:blender-beta` are two servers. Without the
    // separator in the prefix, removing the first takes the second with it.
    const one = { namespace: "mcp:blender", name: "render" };
    const two = { namespace: "mcp:blender-beta", name: "render" };

    grants.grant(one, SCOPE, "always");
    grants.grant(two, SCOPE, "always");

    expect(grants.revokeNamespace("mcp:blender")).toBe(1);
    expect(grants.find(two, SCOPE)).toBeDefined();
  });

  it("marks rather than deletes, so the record survives", () => {
    grants.grant({ namespace: "mcp:blender", name: "render" }, SCOPE, "always");

    grants.revokeNamespace("mcp:blender");

    const row = db
      .prepare("SELECT revoked_at FROM permission_grant WHERE capability_key = ?")
      .get("mcp:blender/render") as { revoked_at: number | null } | undefined;

    expect(row?.revoked_at).toBeTypeOf("number");
  });

  it("revokes nothing the second time", () => {
    grants.grant({ namespace: "mcp:blender", name: "render" }, SCOPE, "always");

    expect(grants.revokeNamespace("mcp:blender")).toBe(1);
    expect(grants.revokeNamespace("mcp:blender")).toBe(0);
  });
});
