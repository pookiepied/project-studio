import { readFileSync } from "node:fs";

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
 * argument at one call site: the agent passed Flue's initializer `id` where
 * the conversation was meant, and a defect in that field went unnoticed
 * because nothing covered how the scope was built. Under Flue 2.0 the
 * instance id IS the conversation id, so the render passes it bare, and the
 * factory turns it into the permission scope. What is pinned here is the
 * render's half of that guard - the instance id goes to `conversationId`,
 * the pinned constant goes to `agentId`, and neither can drift - while
 * conversation-mode.test.ts pins the factory's half against a real runtime:
 * two conversations of one agent build two scopes.
 *
 * Flue 2.0's hooks throw outside a render and the runtime ships no public
 * render harness, so the call-shape assertions below read the module's
 * source - the same precedent title-agent.test.ts sets, for the same reason.
 * Everything the module's VALUES can answer is asserted against the values.
 *
 * The sync read needs no warmed cache: `conversationTurnSettings` reads the
 * row the turn-settings middleware settled before admission (Phase 0's
 * measurement), so the host stub answers synchronously, exactly as the real
 * runtime does.
 */

const STUDIO_SOURCE = readFileSync(
  new URL("../../src/agents/studio.ts", import.meta.url),
  "utf8",
);

const host: AgentHost = {
  // The recorded factory: what the render passes to `createAgentSandbox` is
  // the contract under test here, and the factory's behaviour is the real
  // runtime's, covered in conversation-mode.test.ts. A sandbox whose
  // createSandbox throws keeps an accidental turn loud instead of silent.
  createAgentSandbox: () => ({
    createSandbox: async () => {
      throw new Error("The unit harness mounts no usable sandbox.");
    },
  }),
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

  it("carries the hour-long durability the permission path waits under", () => {
    // A turn in Manual can park on a question for as long as a person is
    // away; the ceiling exists for that wait and nothing else. The value is
    // asserted so a silent change to either number is a decision, not a
    // drift.
    expect(Studio.durability).toEqual({ maxAttempts: 3, timeoutMs: 3_600_000 });
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

  it("hands the factory the instance id as the conversation, and the agent separately", () => {
    // The #69 guard at its call site. A render cannot be driven in a unit
    // test (no public render harness), so the shape is read from the module
    // - but the HALF that has values is asserted as values below: the
    // factory the render mounts is the locator runtime's, and the
    // conversation id it will be given is the render's own props id, which
    // is what the source names.
    expect(STUDIO_SOURCE).toContain("conversationId: id,");
    expect(STUDIO_SOURCE).toContain("agentId: STUDIO_AGENT_ID,");
    // The scope the factory builds from those arguments is covered against
    // a real runtime in conversation-mode.test.ts, which asserts that two
    // conversations of one agent are two scopes.
  });

  it("mounts no tool hooks: the gate's tools ride the sandbox factory", () => {
    // Studio's tools are the CallGate's, exposed through the factory's own
    // `tools` member (studio-runtime.ts). A second path - `useTool` here -
    // would be ungated capability reach; its absence is a security property,
    // and the runtime ships no render harness, so the module's shape is the
    // check.
    expect(STUDIO_SOURCE).not.toMatch(/useTool\(/);
    expect(STUDIO_SOURCE).toContain("useSandbox(");
  });

  it("appends the environment block after the static prompt", () => {
    // The order is the cache argument: the static prompt stays
    // byte-identical across conversations so it and the tool array form one
    // cached prefix, and the environment block rides after it. Checked on
    // the module's shape because the rendered instructions are only
    // observable through a render.
    const promptReturn = STUDIO_SOURCE.slice(
      STUDIO_SOURCE.indexOf("return `${STUDIO_SYSTEM_PROMPT}"),
    );
    expect(promptReturn).toContain("STUDIO_SYSTEM_PROMPT");
    expect(promptReturn.indexOf("environmentBlock")).toBeGreaterThan(-1);
  });
});
