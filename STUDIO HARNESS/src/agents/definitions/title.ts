import { TITLE_AGENT_ID } from "../../contracts/agents.js";
import { TITLE_PROMPT } from "../../context/title-prompt.js";
import { validateAgentDefinition } from "./registry.js";

/**
 * The automatic titling agent's definition.
 *
 * The pattern all three background agents share, stated here as data: a
 * fixed prompt as the entire instruction set, one bounded attempt, no
 * sandbox, no tools, and a model the definition names rather than a
 * conversation settling. What the definition does NOT carry is the ladder —
 * the attempt-number read that steps one rung down the model ladder is
 * logic, not data, and it stays in the agent module where the render can
 * reach it. The record says what the agent is; the render stays how it runs.
 *
 * The module imports the definition, never the reverse: a definition file
 * that imported its agent module would be a cycle (the agent's statics read
 * the definition's durability at load), and the function-value pairing the
 * registry needs lives in `index.ts`, where both sides are already loaded.
 *
 * Durability is the same pair the module's `Title.durability` static
 * carries, and the module reads it from here — one source, so the registry
 * and the runtime cannot disagree about how long a title may take.
 */
export const titleDefinition = validateAgentDefinition({
  identity: {
    agentName: TITLE_AGENT_ID,
    title: "Titler",
    description: "Names a conversation once, from its first exchange.",
  },
  kind: "background",
  instructions: TITLE_PROMPT,
  // Rank zero of the background ladder, read once here so the definition
  // says the class of model; the attempt-suffix read in the render still
  // steps down it. A rank-zero ladder with nothing cheaper is the stable
  // alias, which is exactly what `titleModelSpecifier(0)` answers.
  model: { specifier: "project-studio/default", thinkingLevel: "off" },
  durability: { maxAttempts: 1, timeoutMs: 30_000 },
});
