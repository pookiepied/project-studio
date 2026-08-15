import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ExecutionScope } from "../../src/contracts/capabilities.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * What a grant is keyed by.
 *
 * This file exists because the question was got wrong from reading the code.
 * `createAgentSandbox({ agentId: id })` reads as "the agent", and
 * `ExecutionScope.conversationId` defaults to `conversation:${agentId}`, so the
 * pair looks like one identity duplicated per *agent*. It is not: Flue's
 * initializer `id` is the **agent instance**, one per conversation thread —
 * measured, by probing a running harness across two threads, as `alpha` and
 * `beta` rather than `studio`.
 *
 * So `agentId` carries a conversation identity and there is no agent dimension
 * in a grant at all. That is issue #69. These tests pin what the store does
 * today so the next person reasons from a measurement rather than from a name.
 */

const READ = { namespace: "native", name: "read" } as const;

function scopeFor(instanceId: string): ExecutionScope {
  // Exactly what `StudioRuntime.createAgentSandbox` builds from Flue's `id`.
  return {
    clientId: "test-client",
    sessionId: "test-session",
    agentId: instanceId,
    conversationId: `conversation:${instanceId}`,
    projectId: "proj-1",
  };
}

const ALPHA = scopeFor("alpha");
const BETA = scopeFor("beta");

let db: StudioDatabase;
let grants: PermissionGrantStore;

beforeEach(() => {
  db = openDatabase({ path: ":memory:" });
  grants = new PermissionGrantStore(db);
});

afterEach(() => {
  db.close();
});

describe("what a permission grant is keyed by", () => {
  it("keeps a conversation-scoped approval inside its own conversation", () => {
    grants.grant(READ, ALPHA, "conversation", "src/**");

    expect(grants.find(READ, ALPHA, "src/app.ts")).toBeDefined();
    expect(grants.find(READ, BETA, "src/app.ts")).toBeUndefined();
  });

  it("does not carry an approval between two agent instances", () => {
    grants.grant(READ, ALPHA, "always", "src/**");

    expect(grants.find(READ, ALPHA, "src/app.ts")).toBeDefined();
    // Isolation, and the safe direction: an unrecognised scope is asked about
    // rather than assumed. This half is correct and worth holding.
    expect(grants.find(READ, BETA, "src/app.ts")).toBeUndefined();
  });

  /**
   * **This documents a defect (#69). It is not a property to preserve.**
   *
   * `always` and `conversation` are meant to be different answers — ADR 0015
   * keeps breadth and duration independent precisely so "for now" and "from now
   * on" are separable. Because `agent_id` holds a conversation identity and the
   * lookup filters on it, a standing grant cannot outlive the conversation that
   * made it, so the two durations are indistinguishable in effect.
   *
   * It fails closed: the user is asked again rather than silently authorized,
   * which is why this is a correctness and approval-fatigue defect and not a
   * security one. When #69 is fixed this test should fail, and the fix is to
   * delete it — not to restore the behaviour it describes.
   */
  it("cannot tell always from conversation, because agent_id is a conversation (#69)", () => {
    const standing = scopeFor("standing");
    const perConversation = scopeFor("per-conversation");
    grants.grant(READ, standing, "always", "src/**");
    grants.grant(READ, perConversation, "conversation", "src/**");

    // Each is honoured where it was made. Nothing surprising yet.
    expect(grants.find(READ, standing, "src/app.ts")).toBeDefined();
    expect(grants.find(READ, perConversation, "src/app.ts")).toBeDefined();

    // Seen from a third conversation the two durations are the same answer.
    // A `conversation` grant stopping here is the point of that duration; an
    // `always` grant stopping here is the defect — "from now on" lasts exactly
    // as long as "for now".
    expect(grants.find(READ, BETA, "src/app.ts")).toBeUndefined();
  });
});
