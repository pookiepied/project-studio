import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { CapabilityDescriptor, ExecutionScope } from "../../src/contracts/capabilities.js";
import { ApprovalBook, targetFrom } from "../../src/computer/approvals.js";
import { classify, requestBudget } from "../../src/computer/session.js";
import { McpCapabilityCatalog, systemActorMeta } from "../../src/extend/mcp/capabilities.js";
import type { McpServerRecord } from "../../src/extend/mcp/registry.js";
import { PermissionError } from "../../src/permissions/errors.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { PermissionKernel, type PermissionApprover } from "../../src/permissions/kernel.js";
import type { GrantDuration, PermissionRequest } from "../../src/permissions/policy.js";
import { LocalSandbox } from "../../src/sandbox/local-sandbox.js";
import { createSandboxPolicy } from "../../src/sandbox/policy.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/*
 * Wave 2 of the computer-use upgrade: the in-component ask (P1-4), the turn
 * stamp (P1-5), and the driver's per-op budgets and coded refusals (P1-7,
 * P1-8). The lease and service halves are in computer-lease.test.ts.
 */

const SCOPE: ExecutionScope = { conversationId: "cnv_1", projectId: "proj-1", agentId: "studio" };

const COMPUTER: CapabilityDescriptor = {
  id: { namespace: "mcp:studio-computer", name: "studio_computer_click" },
  title: "studio_computer_click",
  description: "Click.",
  effects: ["execute", "network"],
  provenance: { origin: "mcp", sourceId: "studio-computer", author: "studio" },
  idempotent: false,
};

let db: StudioDatabase;
let grants: PermissionGrantStore;
beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  grants = new PermissionGrantStore(db);
});
afterEach(() => db.close());

function kernel(duration: GrantDuration, asked: PermissionRequest[] = [], mode: "ask" | "auto" = "ask"): PermissionKernel {
  const approver: PermissionApprover = { request: async (request) => { asked.push(request); return { verdict: "allow", duration }; } };
  const created = new PermissionKernel({ grants, approver, posture: { trust: () => "trusted", mode: () => mode } });
  created.register(COMPUTER);
  return created;
}

describe("the kernel's half of the ask", () => {
  it("asks about a computer target even in Auto, and tells the approver the longest answer it takes", async () => {
    const asked: PermissionRequest[] = [];
    await kernel("once", asked, "auto").authorize(COMPUTER.id, SCOPE, { resource: "computer:terminal:windowsterminal", kind: "command", maxDuration: "conversation" });
    expect(asked).toHaveLength(1);
    expect(asked[0]?.maxDuration).toBe("conversation");
  });

  it("refuses an answer longer than the request allows instead of shortening it, and stores nothing", async () => {
    const refused = kernel("always").authorize(COMPUTER.id, SCOPE, { resource: "computer:password_field:app", kind: "command", maxDuration: "once" });
    await expect(refused).rejects.toBeInstanceOf(PermissionError);
    await expect(refused).rejects.toThrow("refused rather than shortened");
    expect(grants.find(COMPUTER.id, SCOPE, "computer:password_field:app", "command")).toBeUndefined();
  });

  it("lets a conversation answer stand for the rest of the conversation without asking again", async () => {
    const asked: PermissionRequest[] = [];
    const k = kernel("conversation", asked);
    const call = { resource: "computer:terminal:windowsterminal", kind: "command" as const, maxDuration: "conversation" as const };
    await k.authorize(COMPUTER.id, SCOPE, call);
    await k.authorize(COMPUTER.id, SCOPE, call);
    expect(asked).toHaveLength(1);
  });

  it("does not ask about an ordinary computer call, which names no target", () => {
    expect(kernel("once").evaluate(COMPUTER.id, SCOPE, { resource: undefined, kind: "command" }).source).not.toBe("policy");
  });
});

function system(): McpServerRecord {
  return { id: "studio-computer", title: "Computer", description: "", provenance: "system", transport: "stdio", command: "node", args: [], env: {}, auth: "none", needsNetwork: false };
}

describe("the harness bridge", () => {
  let workspace: string;
  beforeEach(() => { workspace = mkdtempSync(join(tmpdir(), "studio-computer-approval-")); });
  afterEach(() => rmSync(workspace, { recursive: true, force: true }));

  const ASKED = { isError: true, content: [{ type: "text", text: "No input was sent." }],
    structuredContent: { approvalRequest: { id: "a1", category: "terminal", app: "WindowsTerminal", displayName: "x", riskLevel: "high", allowPersistentApproval: false, maxDuration: "conversation" } } };

  async function run(answers: unknown[], authorize: ((resource: string, limits?: { maxDuration?: GrantDuration }) => Promise<void>) | undefined, provenance: "system" | "user" = "system") {
    const metas: unknown[] = [];
    const catalog = new McpCapabilityCatalog({ actorMeta: () => ({ "studio/actor": "cnv_1", "studio/role": "conversation" }) });
    const connection = {
      request: async (method: string, params?: unknown) => {
        if (method === "tools/list") return { tools: [{ name: "studio_computer_click", description: "", inputSchema: { type: "object" } }] };
        metas.push((params as { _meta?: unknown })._meta);
        return answers.shift();
      },
    };
    const [tool] = await catalog.refresh({ ...system(), provenance }, connection);
    if (tool === undefined) throw new Error("no tool");
    const result = await tool.execute({ x: 1 }, {
      scope: SCOPE, sandbox: new LocalSandbox(createSandboxPolicy({ workspaceRoot: workspace })), signal: undefined,
      ...(authorize === undefined ? {} : { authorize }),
    }) as { isError: boolean; content: { text?: string }[] };
    return { result, metas, text: result.content.map((part) => part.text ?? "").join("\n") };
  }

  it("asks the kernel about the named process with the request's limit, then sends once with the approval id", async () => {
    const asked: [string, unknown][] = [];
    const { result, metas } = await run([ASKED, { content: [{ type: "text", text: "Clicked." }] }], async (resource, limits) => { asked.push([resource, limits]); });
    expect(asked).toEqual([["computer:terminal:windowsterminal", { maxDuration: "conversation" }]]);
    expect(metas).toHaveLength(2);
    expect(metas[0]).not.toHaveProperty("studio/approval");
    expect(metas[1]).toMatchObject({ "studio/approval": "a1" });
    expect(result.isError).toBe(false);
  });

  it("sends nothing more when the person declines, and says so without inviting a workaround", async () => {
    const { result, metas, text } = await run([ASKED], async () => { throw new PermissionError("denied", { message: "You declined this action." }); });
    expect(metas).toHaveLength(1);
    expect(result.isError).toBe(true);
    expect(text).toContain("No input was sent");
    expect(text).toContain("did not approve");
  });

  it("refuses with nobody to ask, and never retries", async () => {
    const { metas, text } = await run([ASKED], undefined);
    expect(metas).toHaveLength(1);
    expect(text).toContain("nobody here can be asked");
  });

  it("says the target changed instead of asking a second time", async () => {
    let asks = 0;
    const { metas, text } = await run([ASKED, ASKED], async () => { asks++; });
    expect(asks).toBe(1);
    expect(metas).toHaveLength(2);
    expect(text).toContain("changed while they were asked");
  });

  it("never acts on an approval request from a server Studio did not write", async () => {
    let asks = 0;
    const { metas } = await run([ASKED], async () => { asks++; }, "user");
    expect(asks).toBe(0);
    expect(metas).toEqual([undefined]);
  });
});

describe("the approval book", () => {
  const terminal = { category: "terminal" as const, app: "WindowsTerminal", pid: 9, processStarted: "1" };

  it("holds an answered request for its own actor and exact process, once", () => {
    const book = new ApprovalBook();
    const request = book.ask("a", terminal);
    book.accept(request.id, "b");
    expect(book.take("b", terminal)).toBe(false);
    const again = book.ask("a", terminal);
    book.accept(again.id, "a");
    expect(book.take("a", { ...terminal, pid: 10 })).toBe(false);
    expect(book.take("a", terminal)).toBe(true);
    expect(book.take("a", terminal)).toBe(false);
  });

  it("forgets an answer that was not used within two minutes", () => {
    let now = 0;
    const book = new ApprovalBook(() => now);
    book.accept(book.ask("a", terminal).id, "a");
    now = 3 * 60 * 1000;
    expect(book.take("a", terminal)).toBe(false);
  });

  it("reads only process identity and a flag from the driver, and ranks a password field over its app", () => {
    expect(targetFrom({ app: "chrome", pid: 1, processStarted: "2", category: "browser", password: true, title: "Bank login" }))
      .toEqual({ category: "password_field", app: "chrome", pid: 1, processStarted: "2" });
    expect(targetFrom({ app: "notepad", pid: 1, category: null, password: false })).toBeUndefined();
    expect(targetFrom({ app: "x", category: "anything" })).toBeUndefined();
  });
});

describe("the turn a computer call belongs to", () => {
  it("is the harness's submission id, passed through as it is", () => {
    const scope = { conversationId: "conv_1", projectId: undefined, agentId: "studio" };
    expect(systemActorMeta(scope, "conv_1", () => undefined, () => false, "sub_abc")).toMatchObject({ "studio/turn": "sub_abc" });
    expect(systemActorMeta(scope, "voice_abc", () => "Hazel", () => false, "sub_t")).toMatchObject({ "studio/role": "worker", "studio/turn": "sub_t" });
    expect(systemActorMeta(scope, "conv_1", () => undefined)).not.toHaveProperty("studio/turn");
  });
});

describe("driver budgets and refusal codes", () => {
  it("gives each op its own deadline, and ops with a length their length", () => {
    expect(requestBudget("cursor")).toBe(2_000);
    expect(requestBudget("click")).toBeLessThanOrEqual(10_000);
    expect(requestBudget("screenshot")).toBe(10_000);
    expect(requestBudget("wait_window", { seconds: 20 })).toBe(22_000);
    expect(requestBudget("wait_window", { seconds: 600 })).toBe(62_000);
    expect(requestBudget("hold", { seconds: 3 })).toBe(8_000);
    expect(requestBudget("type", { text: "x".repeat(1000) })).toBe(38_000);
    expect(requestBudget("unknown_op")).toBe(60_000);
  });

  it("sorts a refusal by its code alone, and an unknown code as bad input", () => {
    expect(classify("Read the window again.", undefined).kind).toBe("bad_input");
    expect(classify("Gone.", "no_element").kind).toBe("no_element");
    expect(classify("Windows refused.", "refused").kind).toBe("refused");
    expect(classify("The person held Escape.", "control").kind).toBe("control");
    expect(classify("x", "internal").kind).toBe("bad_input");
  });
});
