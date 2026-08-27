import { describe, expect, it } from "vitest";

import studioAgent from "../../src/agents/studio.js";
import {
  configureStudioRuntime,
  type AgentHost,
  type StudioAgentSandboxOptions,
} from "../../src/application/studio-runtime.js";
import type { SandboxFactory } from "@flue/runtime";

/**
 * What the agent module tells the runtime about itself.
 *
 * #69 did not live in the grant store — that code was right. It lived in one
 * argument at one call site: `agents/studio.ts` passed Flue's initializer `id`
 * as `agentId`, and `id` is the agent *instance*, one per conversation thread.
 * `grant-identity.test.ts` covers what the store does with a scope; nothing
 * covered how the scope is built, which is why a defect in the field it is
 * built from went unnoticed.
 *
 * The initializer is reachable: `AgentDefinition.initialize(context)` is part
 * of Flue's public type, and the service locator that exists because Flue
 * loads this module itself (ADR 0035 §6) is what makes a stub host possible.
 */

const sandbox = {} as SandboxFactory;

function hostRecording(calls: StudioAgentSandboxOptions[]): AgentHost {
  return {
    projectRoot: process.cwd(),
    start: async () => undefined,
    reconcile: async () => undefined,
    createAgentSandbox: (options) => {
      calls.push(options);
      return sandbox;
    },
    // No index exists in this test's process, so the agent reads the default
    // settings: the stable alias at the provider's own reasoning behaviour.
    conversationTurnSettings: () => ({ modelId: null, reasoningLevel: null }),
  };
}

describe("the studio agent's execution scope", () => {
  it("names the agent, and puts the Flue instance id in the conversation", async () => {
    const calls: StudioAgentSandboxOptions[] = [];
    // Configured once per process by design — it throws on a second call — so
    // this is the only test in the file and the assertions are grouped.
    configureStudioRuntime(hostRecording(calls));

    await studioAgent.initialize({ id: "alpha", env: {} });
    await studioAgent.initialize({ id: "beta", env: {} });

    expect(calls.map((call) => call.agentId)).toEqual(["studio", "studio"]);
    // Two threads of the same agent are two conversations. Before the fix
    // these were "alpha" and "beta" in the agent field, which is what made a
    // standing grant unable to leave the thread that gave it.
    expect(calls.map((call) => call.conversationId)).toEqual([
      "conversation:alpha",
      "conversation:beta",
    ]);
  });
});
