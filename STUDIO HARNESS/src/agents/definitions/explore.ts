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
 * shown the child's asks in v1. `maxEffects: ["read", "network"]` is the
 * ceiling that makes the allowlist's claims a three-layer agreement
 * rather than a hope: the model sees only readers (allowlist), the
 * kernel refuses any write or run (ceiling), and the sandbox holds the
 * same boundary (containment).
 *
 * `network` is in the ceiling and `write` is not, and that is the
 * corrected reading of D11's "read-only": the web readers' whole effect
 * is `network`, and a ceiling of `["read"]` alone made them visible
 * tools that could never run — every fetch refused at the ceiling in
 * every conversation, the delegate's model burning a turn to learn its
 * own array lied to it. Reading the web is reading; the ceiling's job is
 * the boundary nothing may cross, which is changing anything on or
 * beyond this machine by writing or running. Authorization for the
 * network calls still stops at the kernel under this agent's own id,
 * exactly as it does for the conversation's.
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
    // A delegate never inherits an approval (ADR 0038's grant-isolation
    // property, #49): what asks, asks under its own agent id. The default
    // follows the conversation's mode, so Auto is not stopped by its own
    // explorer; the read ceiling above is what keeps this agent read-only.
    maxEffects: ["read", "network"],
    mode: "inherit",
  },
  durability: { maxAttempts: 3, timeoutMs: 600_000 },
});
