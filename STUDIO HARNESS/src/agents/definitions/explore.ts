import { EXPLORE_AGENT_ID } from "../../contracts/agents.js";
import { EXPLORE_PROMPT } from "../../context/explore-prompt.js";
import { validateAgentDefinition } from "./registry.js";

/**
 * The read-only research delegate's definition (ADR 0058 D11, Stage 3).
 *
 * The first `delegate`-kind definition in the registry, and the contract
 * that comes with it: the registry refuses a delegate without all three
 * policy fields (a delegate without an allowlist inherits the parent's
 * whole tool array — the Stage 0 measurement), so everything this record
 * says is load-bearing, and every field is a constraint the gate, the
 * scope, and the system prompt's roster section all resolve against.
 *
 * The allowlist is the read-only research surface from the plan's D11
 * table: the four filesystem/repository readers plus the two web readers.
 * What is deliberately absent is as much a decision as what is present —
 * `discover` (a delegate adopting a tool would leak into the parent's
 * conversation-keyed adopted set, the two-writer bug ADR 0029 exists to
 * prevent; withheld from every delegate in v1), every writer and runner
 * (`write`, `edit`, `delete`, `move`, `shell`), and the interactive
 * family (`ask_user_question`, `request_folder`, `plan`, `library_*`,
 * `studio_*`, `ocr`, `jobs`) — a delegate holds no conversation of its
 * own to park a question in, and the person watching the parent is not
 * shown the child's asks in v1. `maxEffects: ["read"]` is the ceiling
 * that makes the allowlist's read-only claim a three-layer agreement
 * rather than a hope: the model sees only readers (allowlist), the
 * kernel refuses any effect outside `["read"]` (ceiling), and the
 * sandbox holds the same boundary (containment).
 *
 * The module imports the definition, never the reverse: a definition
 * file that imported its agent module would be a cycle (the agent's
 * statics read the definition's durability at load), and the
 * function-value pairing the `useSubagent` mount needs lives in
 * `index.ts`, where both sides are already loaded.
 */
export const exploreDefinition = validateAgentDefinition({
  identity: {
    agentName: EXPLORE_AGENT_ID,
    title: "Explorer",
    description:
      "Read-only research: finds where things are, reads them, and answers with what it found. Use it for searches and reading that would flood this conversation with context.",
  },
  kind: "delegate",
  instructions: EXPLORE_PROMPT,
  // Inherits the conversation's settled model. The plan's D11 leaves the
  // cheap-model override to the definitions that want it (the
  // classification pattern); research quality is the thing being bought
  // here, and the parent already chose the model it trusts for its own
  // reading. `AgentModelPolicy` has no `{inherit: true}`-with-thinkingLevel
  // shape — inheritance means the parent's model AND level, verbatim.
  model: { inherit: true },
  tools: {
    natives: ["read", "glob", "grep", "git", "web_search", "fetch"],
    mcpNamespaces: [],
  },
  skills: { ids: [] },
  permissions: {
    maxEffects: ["read"],
    // A delegate never inherits an approval (ADR 0038's grant-isolation
    // property, #49): the child asks, under its own agent id, and the
    // honest default for that is `ask` — an explore run is not the thing
    // Full Auto should silently widen. `git`'s write options and the web
    // readers' network effect both stop here first when the conversation
    // would not.
    mode: "ask",
  },
  durability: { maxAttempts: 3, timeoutMs: 600_000 },
});
