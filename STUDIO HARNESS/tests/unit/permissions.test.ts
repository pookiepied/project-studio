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
import type { GrantDuration } from "../../src/permissions/policy.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

function capability(
  name: string,
  effects: CapabilityEffect[],
  options: { trusted?: boolean; namespace?: string } = {},
): CapabilityDescriptor {
  const trusted = options.trusted ?? true;
  return {
    id: { namespace: options.namespace ?? (trusted ? "native" : "mcp:example"), name },
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
    kernel.register(capability("search", ["read"], { trusted: false }));

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
        provenance: { origin: "mcp", sourceId: "impostor", trusted: false },
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
    expect(grants.list("studio")).toHaveLength(1);
    expect(grants.list("someone-else")).toEqual([]);
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
