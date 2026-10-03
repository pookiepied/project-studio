import { DESCRIBE_AGENT_ID } from "../../contracts/agents.js";
import { DESCRIBE_PROMPT } from "../../context/describe-prompt.js";
import { validateAgentDefinition } from "./registry.js";

/**
 * The image-describing agent's definition — the background pattern
 * (title.ts's docblock) with a longer timeout than the other two, because a
 * picture with a description attached travels more slowly than eight words
 * or a punctuation pass. The person's default model, so the picture goes
 * nowhere it would not go in an ordinary message. The module imports the
 * definition, never the reverse (title.ts's docblock says why).
 */
export const describeDefinition = validateAgentDefinition({
  identity: {
    agentName: DESCRIBE_AGENT_ID,
    title: "Describer",
    description: "Proposes a title, description and tags for a kept picture.",
  },
  kind: "background",
  instructions: DESCRIBE_PROMPT,
  model: { specifier: "project-studio/default", thinkingLevel: "off" },
  durability: { maxAttempts: 1, timeoutMs: 45_000 },
});
