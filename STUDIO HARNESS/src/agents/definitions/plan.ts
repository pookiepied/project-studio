import { PLAN_AGENT_ID } from "../../contracts/agents.js";
import { PLAN_PROMPT } from "../../context/plan-prompt.js";
import { validateAgentDefinition } from "./registry.js";

/**
 * The planning delegate's definition (ADR 0058 D11, Stage 5): read-only
 * research plus the plan tool, producing and updating the list the person
 * ticks while the work happens.
 *
 * The allowlist is the readers `explore` carries minus the web pair, plus
 * `plan` — the D11 row's exact four. The plan tool declares `read` and
 * nothing else (its whole action is recording an intention in the
 * conversation's own table, the same honesty `ask_user_question` claims),
 * so `maxEffects: ["read"]` is true with the tool in the array, and the
 * three-layer read-only agreement holds unchanged from the explorer's.
 * Nothing here writes a file, runs a command, or reaches the network;
 * plan rows are the one thing this delegate moves, and the store merges
 * them by id so the person's ticks survive every write (S5.2's second
 * writer, asserted in the store and route suites).
 *
 * `mcpNamespaces: []` and `skills: {ids: []}` are the explorer's v1
 * posture carried over: no server namespace is this delegate's to name,
 * and no bundled skill belongs to planning.
 *
 * The module imports the definition, never the reverse; the function-value
 * pairing the `useSubagent` mount needs lives in `index.ts`.
 */
export const planDefinition = validateAgentDefinition({
  identity: {
    agentName: PLAN_AGENT_ID,
    title: "Planner",
    description:
      "Read-only planning: works out the steps a task needs and writes them into the conversation's plan for the person to follow and tick. Use it when a task is worth a visible plan before any of it starts.",
  },
  kind: "delegate",
  instructions: PLAN_PROMPT,
  // Inherits the conversation's settled model, the roster's one rule: no
  // delegate silently downgrades the model the parent chose.
  model: { inherit: true },
  tools: {
    natives: ["read", "glob", "grep", "plan"],
    mcpNamespaces: [],
  },
  skills: { ids: [] },
  permissions: {
    maxEffects: ["read"],
    // Same consent default as every delegate: the conversation's mode. Reads
    // default-allow anyway, so this is the honest declaration rather than a
    // live gate.
    mode: "inherit",
  },
  durability: { maxAttempts: 3, timeoutMs: 600_000 },
});
