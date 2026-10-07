import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { agentRegistry } from "../../src/agents/definitions/index.js";
import {
  AgentRegistry,
  AgentRegistryError,
  validateAgentDefinition,
} from "../../src/agents/definitions/registry.js";
import {
  DESCRIBE_AGENT_ID,
  EXPLORE_AGENT_ID,
  GENERAL_AGENT_ID,
  IMPROVE_AGENT_ID,
  PLAN_AGENT_ID,
  STUDIO_AGENT_ID,
  TITLE_AGENT_ID,
} from "../../src/contracts/agents.js";
import { describeDefinition } from "../../src/agents/definitions/describe.js";
import { exploreDefinition } from "../../src/agents/definitions/explore.js";
import { generalDefinition } from "../../src/agents/definitions/general.js";
import { improveDefinition } from "../../src/agents/definitions/improve.js";
import { planDefinition } from "../../src/agents/definitions/plan.js";
import { studioDefinition } from "../../src/agents/definitions/studio.js";
import { titleDefinition } from "../../src/agents/definitions/title.js";
import { Describe } from "../../src/agents/describe.js";
import { Explore } from "../../src/agents/explore.js";
import { General } from "../../src/agents/general.js";
import { Improve } from "../../src/agents/improve.js";
import { Plan } from "../../src/agents/plan.js";
import { Studio } from "../../src/agents/studio.js";
import { Title } from "../../src/agents/title.js";
import { STUDIO_SYSTEM_PROMPT } from "../../src/context/system-prompt.js";
import { TITLE_PROMPT } from "../../src/context/title-prompt.js";
import { IMPROVE_PROMPT } from "../../src/context/improve-prompt.js";
import { DESCRIBE_PROMPT } from "../../src/context/describe-prompt.js";
import { EXPLORE_PROMPT } from "../../src/context/explore-prompt.js";
import { GENERAL_PROMPT } from "../../src/context/general-prompt.js";
import { PLAN_PROMPT } from "../../src/context/plan-prompt.js";

/** A valid delegate-shaped definition, for the refusal cases to corrupt one field at a time. */
function validDelegateInput(): Record<string, unknown> {
  return {
    identity: {
      agentName: "explore",
      title: "Explorer",
      description: "Read-only research delegate.",
    },
    kind: "delegate",
    instructions: "You are a read-only researcher.",
    model: { inherit: true },
    tools: {
      natives: ["read", "glob", "grep"],
      mcpNamespaces: [],
    },
    skills: { ids: [] },
    permissions: { maxEffects: ["read"], mode: "ask" },
    durability: { maxAttempts: 1, timeoutMs: 60_000 },
  };
}

describe("the agent registry", () => {
  it("holds the seven live agents under their contract ids", () => {
    expect(agentRegistry.get(STUDIO_AGENT_ID)?.definition).toBe(studioDefinition);
    expect(agentRegistry.get(TITLE_AGENT_ID)?.definition).toBe(titleDefinition);
    expect(agentRegistry.get(IMPROVE_AGENT_ID)?.definition).toBe(improveDefinition);
    expect(agentRegistry.get(DESCRIBE_AGENT_ID)?.definition).toBe(describeDefinition);
    expect(agentRegistry.get(EXPLORE_AGENT_ID)?.definition).toBe(exploreDefinition);
    expect(agentRegistry.get(GENERAL_AGENT_ID)?.definition).toBe(generalDefinition);
    expect(agentRegistry.get(PLAN_AGENT_ID)?.definition).toBe(planDefinition);
  });

  it("pairs each definition with the same function object Flue registers", () => {
    // dispatch() resolves by function value, so the registry carrying a
    // different object than the module exports would dispatch nothing. The
    // Windows double-bundle bug made exactly this happen once already. For
    // the delegates the same identity is what the useSubagent mount hands
    // Flue - a different object here would be a delegate Flue could not
    // resolve at render time.
    expect(agentRegistry.get(STUDIO_AGENT_ID)?.agent).toBe(Studio);
    expect(agentRegistry.get(TITLE_AGENT_ID)?.agent).toBe(Title);
    expect(agentRegistry.get(IMPROVE_AGENT_ID)?.agent).toBe(Improve);
    expect(agentRegistry.get(DESCRIBE_AGENT_ID)?.agent).toBe(Describe);
    expect(agentRegistry.get(EXPLORE_AGENT_ID)?.agent).toBe(Explore);
    expect(agentRegistry.get(GENERAL_AGENT_ID)?.agent).toBe(General);
    expect(agentRegistry.get(PLAN_AGENT_ID)?.agent).toBe(Plan);
  });

  it("hands out exactly one conversation agent", () => {
    expect(agentRegistry.conversationAgent().definition).toBe(studioDefinition);
  });

  it("names exactly the three delegates in the delegate roster", () => {
    // Stage 5's roster. The useSubagent mount, the gate's acting-agent
    // filter, and the scope substitution all resolve through this list;
    // a delegate missing from it is invisible to all three at once, and
    // an extra one is a delegate the mount would arm without a
    // definition's policy behind it.
    expect(agentRegistry.byKind("delegate").map((entry) => entry.definition.identity.agentName))
      .toEqual([EXPLORE_AGENT_ID, GENERAL_AGENT_ID, PLAN_AGENT_ID]);
  });

  it("sorts the roster by name", () => {
    expect(agentRegistry.list().map((entry) => entry.definition.identity.agentName)).toEqual([
      DESCRIBE_AGENT_ID,
      EXPLORE_AGENT_ID,
      GENERAL_AGENT_ID,
      IMPROVE_AGENT_ID,
      PLAN_AGENT_ID,
      STUDIO_AGENT_ID,
      TITLE_AGENT_ID,
    ]);
  });

  it("refuses two definitions claiming one name", () => {
    const entry = { definition: studioDefinition, agent: Studio };
    expect(() => new AgentRegistry([entry, entry])).toThrow(AgentRegistryError);
    expect(() => new AgentRegistry([entry, entry])).toThrow(/studio/);
  });

  it("refuses a delegate with no tool allowlist", () => {
    // The Stage 0 measurement: a delegate without an allowlist inherits the
    // parent's whole tool array. Validation refusing the field's absence is
    // what makes that a load-time authoring failure instead of a live
    // visibility/authority gap.
    const input = validDelegateInput();
    delete input.tools;
    expect(() => validateAgentDefinition(input)).toThrow(AgentRegistryError);
  });

  it("refuses a delegate naming a native tool that does not exist", () => {
    const input = validDelegateInput();
    (input.tools as Record<string, unknown>).natives = ["read", "reed", "grep"];
    expect(() => validateAgentDefinition(input)).toThrow(/reed/);
  });

  it("refuses a delegate naming a skill that is not bundled", () => {
    const input = validDelegateInput();
    (input.skills as Record<string, unknown>).ids = ["create-skill", "summarize-pdf"];
    expect(() => validateAgentDefinition(input)).toThrow(/summarize-pdf/);
  });

  it("refuses a conversation agent carrying a static tool allowlist", () => {
    // `studio` composes its tools from live per-conversation state; a static
    // allowlist on the definition would be a second, competing source of
    // the same answer.
    const input = validDelegateInput();
    input.kind = "conversation";
    expect(() => validateAgentDefinition(input)).toThrow(AgentRegistryError);
  });

  it("refuses a background agent carrying a permission policy", () => {
    // The background three hold no tools, so no permission applies; the
    // field's presence would imply a surface that does not exist.
    const input = validDelegateInput();
    input.kind = "background";
    expect(() => validateAgentDefinition(input)).toThrow(AgentRegistryError);
  });

  it("refuses an empty effects ceiling on a delegate", () => {
    // maxEffects is the ceiling on what a delegate's calls may earn; an
    // empty list is not "nothing" but "unvalidated", and the schema refuses
    // it rather than letting a delegate run with a ceiling nobody stated.
    const input = validDelegateInput();
    (input.permissions as Record<string, unknown>).maxEffects = [];
    expect(() => validateAgentDefinition(input)).toThrow(AgentRegistryError);
  });

  it("accepts a well-formed delegate definition", () => {
    expect(validateAgentDefinition(validDelegateInput()).identity.agentName).toBe("explore");
  });
});

describe("the definitions' own modules", () => {
  it("read their durability from one place: the definition", () => {
    // The agent modules' `durability` statics are assigned from the
    // definitions, so the runtime's retry policy and the registry cannot
    // disagree. If someone re-pinlines a number in the module, this fails.
    expect(Studio.durability).toEqual(studioDefinition.durability);
    expect(Title.durability).toEqual(titleDefinition.durability);
    expect(Improve.durability).toEqual(improveDefinition.durability);
    expect(Describe.durability).toEqual(describeDefinition.durability);
    expect(Explore.durability).toEqual(exploreDefinition.durability);
    expect(General.durability).toEqual(generalDefinition.durability);
    expect(Plan.durability).toEqual(planDefinition.durability);
  });

  it("carry the prompts the renders return", () => {
    // The definition's instructions are the same bytes the agent function
    // hands the model (static part, for studio) - one instruction set, so
    // the roster's description of an agent and the agent itself cannot
    // drift into two documents.
    expect(studioDefinition.instructions).toBe(STUDIO_SYSTEM_PROMPT);
    expect(titleDefinition.instructions).toBe(TITLE_PROMPT);
    expect(improveDefinition.instructions).toBe(IMPROVE_PROMPT);
    expect(describeDefinition.instructions).toBe(DESCRIBE_PROMPT);
    expect(exploreDefinition.instructions).toBe(EXPLORE_PROMPT);
    expect(generalDefinition.instructions).toBe(GENERAL_PROMPT);
    expect(planDefinition.instructions).toBe(PLAN_PROMPT);
  });
});

/**
 * The architecture half of Stage 2: every agent the harness mounts or
 * dispatches resolves through the registry, and nothing renders an
 * unregistered agent function. Source-level like the title-agent suite's
 * shape assertions, because Flue's hooks cannot run outside a render.
 */
describe("the registry is the one roster (architecture)", () => {
  const SRC = join(import.meta.dirname, "..", "..", "src");

  it("knows every agent a 'use agent' module under src/agents exports", () => {
    // Flue's own rule, read the same way the scanner reads it: in a
    // `'use agent'` module, every exported CAPITALIZED function is an
    // agent. Lowercase exports (studioModelSpecifier) are helpers and stay
    // out of the roster, which is why the regex is anchored on the capital.
    const registered = new Set(
      agentRegistry.list().map((entry) => entry.definition.identity.agentName),
    );
    const found: string[] = [];

    for (const entry of readdirSync(join(SRC, "agents"), { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".ts")) continue;
      const source = readFileSync(join(SRC, "agents", entry.name), "utf8");
      // The directive is the module's first statement; without it the file
      // is not an agent module at all (definitions/ has none).
      if (!source.startsWith("'use agent'")) continue;
      for (const match of source.matchAll(/^export function ([A-Z]\w*)\(/gm)) {
        const name = match[1]!.toLowerCase();
        found.push(name);
        expect(registered.has(name), `the agent ${name} must be in the registry`).toBe(true);
      }
    }

    // And the reverse: the registry names nothing that no module exports.
    expect(found.sort()).toEqual([...registered].sort());
  });

  it("is the only thing outside src/agents that imports an agent function", () => {
    // After the three wrappers moved to dispatchBackgroundAgent, the direct
    // imports of agent modules are exactly two, both legitimate: the
    // composition root (app.ts — it mounts the conversation agent), and
    // this suite. A new direct import elsewhere is a dispatch the registry
    // does not mediate, and it fails here.
    const offenders: string[] = [];
    const allowed = new Set([
      // The mount: app.ts hands the agent function to the router, the job
      // pings, and the compaction driver — the one composition site.
      "app.ts",
    ]);
    const queue: string[] = [SRC];
    while (queue.length > 0) {
      const current = queue.pop()!;
      const relative = current.slice(SRC.length + 1).replace(/\\/g, "/");
      for (const entry of readdirSync(current, { withFileTypes: true })) {
        const path = join(current, entry.name);
        if (entry.isDirectory()) {
          if (relative === "" && entry.name === "agents") continue;
          queue.push(path);
          continue;
        }
        if (!entry.name.endsWith(".ts")) continue;
        if (relative === "" && allowed.has(entry.name)) continue;
        const source = readFileSync(path, "utf8");
        if (/from ["'].*agents\/(studio|title|improve|describe|explore|general|plan)\.js["']/.test(source)) {
          offenders.push(path);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
