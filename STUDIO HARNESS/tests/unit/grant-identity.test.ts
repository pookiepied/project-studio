import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { IMPROVE_AGENT_ID, STUDIO_AGENT_ID } from "../../src/contracts/agents.js";
import type { ExecutionScope } from "../../src/contracts/capabilities.js";
import { PermissionGrantStore } from "../../src/permissions/grant-store.js";
import { openDatabase, type StudioDatabase } from "../../src/storage/database.js";

/**
 * What a grant is keyed by.
 *
 * This file exists because the question was got wrong twice from reading code
 * instead of measuring it. First it looked as though every conversation shared
 * one scope (#68, withdrawn — a probe of a running harness across two threads
 * reported `alpha` and `beta`). Then, correctly, as #69: Flue's initializer
 * `id` is the agent *instance*, one per thread, and it was being passed as
 * `agentId`. A grant therefore had no agent dimension at all, and
 * `duration: "always"` could not outlive the conversation that made it.
 *
 * Fixed by naming the agent (`contracts/agents.ts`) and putting the thread id
 * where it belongs. The three columns now mean three different things, and the
 * tests below are one per boundary: conversation, agent, project.
 */

const READ = { namespace: "native", name: "read" } as const;

/** Exactly what `StudioRuntime.createAgentSandbox` now builds. */
function scopeFor(
  threadId: string,
  overrides: { agentId?: string; projectId?: string } = {},
): ExecutionScope {
  return {
    clientId: "test-client",
    sessionId: "test-session",
    agentId: overrides.agentId ?? STUDIO_AGENT_ID,
    // Under Flue 2.0 the agent instance id IS the conversation id, so the
    // scope vocabulary is the bare id - the 1.0 `conversation:` prefix is
    // gone, and what the store keys on is what the render passed.
    conversationId: threadId,
    projectId: overrides.projectId ?? "proj-1",
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

  /**
   * The property #69 was about, stated positively.
   *
   * ADR 0015 keeps breadth and duration independent so that "for now" and
   * "from now on" are separable answers. They are only separable if a standing
   * grant is reachable from a conversation that did not make it. Before the
   * fix this expectation was `toBeUndefined()` and the two durations were one
   * answer wearing two labels.
   */
  it("carries a standing approval into a later conversation of the same agent", () => {
    grants.grant(READ, ALPHA, "always", "src/**");

    expect(grants.find(READ, BETA, "src/app.ts")).toBeDefined();
  });

  it("does not carry a standing approval to a different agent", () => {
    grants.grant(READ, ALPHA, "always", "src/**");

    // The reason `agentId` is a field rather than a constant folded into the
    // conversation: a subagent must not inherit what its parent was granted.
    // Stage 2's registry made real agent ids beside `studio` available to
    // this assertion, so the second agent is now a live one (`improve`, a
    // registered background agent) rather than the synthetic "reviewer" —
    // the #49 property against the ids the harness actually dispatches.
    const background = scopeFor("alpha", { agentId: IMPROVE_AGENT_ID });
    expect(grants.find(READ, background, "src/app.ts")).toBeUndefined();
  });

  it("does not carry a standing approval to a different project", () => {
    grants.grant(READ, ALPHA, "always", "src/**");

    // ADR 0021. Widening `always` from one conversation to every conversation
    // of an agent is the whole change here, so the boundary that stops it from
    // widening further is worth a test in the same file.
    const otherProject = scopeFor("beta", { projectId: "proj-2" });
    expect(grants.find(READ, otherProject, "src/app.ts")).toBeUndefined();
  });
});
