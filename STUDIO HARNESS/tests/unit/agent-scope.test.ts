import { describe, expect, it } from "vitest";

import {
  studioModelSpecifier,
  studioThinkingLevel,
  Studio,
} from "../../src/agents/studio.js";
import {
  configureStudioRuntime,
  type AgentHost,
} from "../../src/application/studio-runtime.js";
import { STUDIO_AGENT_ID } from "../../src/contracts/agents.js";
import { STUDIO_MODEL_ID } from "../../src/contracts/models.js";

/**
 * What the agent module tells the runtime about itself.
 *
 * #69 did not live in the grant store - that code was right. It lived in one
 * argument at one call site: `agents/studio.ts` passed Flue's initializer
 * `id` where the conversation was meant, and a defect in that field went
 * unnoticed because nothing covered how the scope was built. Under Flue 2.0
 * the wiring moves: the instance id IS the conversation id, and the sandbox
 * factory that turns it into a permission scope is Phase 4's port, together
 * with the assertion that the scope is built from it. What this phase pins
 * instead is the two contracts the module itself owns - the durable identity
 * and the model read - because a rename without a pin is a storage-identity
 * change, and a render that ignores the picker's choice decides for the
 * person.
 *
 * The sync read needs no warmed cache: `conversationTurnSettings` reads the
 * row the turn-settings middleware settled before admission (Phase 0's
 * measurement), so the host stub answers synchronously, exactly as the real
 * runtime does.
 */

const host: AgentHost = {
  projectRoot: process.cwd(),
  start: async () => undefined,
  reconcile: async () => undefined,
  // Never called by this phase's agent: the gated factory is Phase 4's port.
  // A throw here keeps an accidental mount loud instead of silent.
  createAgentSandbox: () => {
    throw new Error("The Phase 2/3 agent mounts no sandbox factory yet.");
  },
  conversationTurnSettings: (conversationId) => {
    if (conversationId === "cnv_chosen") {
      return {
        modelId: "openrouter/anthropic/claude-sonnet-4.5",
        reasoningLevel: "high",
      };
    }
    return { modelId: null, reasoningLevel: null };
  },
};

describe("the studio agent's identity and model contracts", () => {
  it("names the agent with the literal the contract constants claim", () => {
    // The build derives the durable identity statically from this literal;
    // a rename here would orphan every stored conversation. The constant
    // and the literal must be the same string, asserted so neither can
    // drift. The same pin exists for the title agent in title-agent.test.ts.
    expect(Studio.agentName).toBe("studio");
    expect(STUDIO_AGENT_ID).toBe("studio");
  });

  it("maps an unset model choice to the stable alias", () => {
    expect(studioModelSpecifier({ modelId: null })).toBe(STUDIO_MODEL_ID);
  });

  it("prefixes a stored reference with the studio provider", () => {
    // The vocabulary is the local runtime's own `<provider>/<model>`; the
    // specifier Flue resolves carries the studio provider in front of it,
    // which is how the model layer routes the request at the named model.
    expect(studioModelSpecifier({ modelId: "openrouter/anthropic/claude-sonnet-4.5" })).toBe(
      "project-studio/openrouter/anthropic/claude-sonnet-4.5",
    );
  });

  it("maps the reasoning choice so 'default' stays no explicit effort", () => {
    // "default" and unset both mean the provider's own behaviour; the
    // runtime would otherwise substitute its own medium for an unset level.
    expect(studioThinkingLevel({ reasoningLevel: null })).toBe("off");
    expect(studioThinkingLevel({ reasoningLevel: "default" })).toBe("off");
    expect(studioThinkingLevel({ reasoningLevel: "high" })).toBe("high");
    // An unknown stored value degrades to the provider's default rather
    // than crashing the render.
    expect(studioThinkingLevel({ reasoningLevel: "nonsense" })).toBe("off");
  });

  it("turns a conversation's settled settings into the specifier the render sends", () => {
    // The host is configured once per process by design - it throws on a
    // second call - so this is the only host-configuring test in the file
    // and the assertions are grouped.
    configureStudioRuntime(host);

    const settings = host.conversationTurnSettings("cnv_chosen");
    expect(studioModelSpecifier(settings)).toBe(
      "project-studio/openrouter/anthropic/claude-sonnet-4.5",
    );
    expect(studioThinkingLevel(settings)).toBe("high");
    // The unset conversation stays on the alias.
    expect(studioModelSpecifier(host.conversationTurnSettings("cnv_fresh"))).toBe(
      STUDIO_MODEL_ID,
    );
  });
});
