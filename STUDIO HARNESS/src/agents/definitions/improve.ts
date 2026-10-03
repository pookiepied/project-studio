import { IMPROVE_AGENT_ID } from "../../contracts/agents.js";
import { IMPROVE_PROMPT } from "../../context/improve-prompt.js";
import { validateAgentDefinition } from "./registry.js";

/**
 * The dictation-improving agent's definition — the background pattern
 * (title.ts's docblock) with the person's default model instead of a ladder
 * rung, by the plan's decision: the tidied words come back in the voice of
 * the model the person already sends words to. The module imports the
 * definition, never the reverse (title.ts's docblock says why).
 */
export const improveDefinition = validateAgentDefinition({
  identity: {
    agentName: IMPROVE_AGENT_ID,
    title: "Improver",
    description: "Tidies a dictated passage once, while the composer waits.",
  },
  kind: "background",
  instructions: IMPROVE_PROMPT,
  model: { specifier: "project-studio/default", thinkingLevel: "off" },
  durability: { maxAttempts: 1, timeoutMs: 30_000 },
});
