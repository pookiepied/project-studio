'use agent';

import type { AgentProps } from "@flue/runtime";

import { exploreDefinition } from "./definitions/explore.js";

/**
 * The read-only research delegate (ADR 0058 D11, Stage 3).
 *
 * This module exists because Flue registers delegates by function: the
 * `task` tool's roster is a `useSubagent({ name, description, agent })`
 * declaration in the PARENT's render, and the function it names is what
 * runs when the parent's model calls `task`. There is no `'use agent'`
 * requirement for a delegate — Flue's scanner registers conversation and
 * dispatch agents, while a delegate is declared per-render through
 * `useSubagent` — but the directive is here anyway, deliberately: it
 * makes the architecture test's rule (every capitalized export of a
 * `'use agent'` module is a registered agent) cover this module too, so
 * `Explore` cannot drift out of the registry's `byKind("delegate")`
 * roster without failing the build.
 *
 * What this render composes is the definition, and nothing else. A
 * delegate's render receives no `{ id }` of its own (Flue's delegate
 * sessions are named `task:<parent>:<taskId>`, runtime-minted), mounts no
 * sandbox (the child shares the parent's already-built environment —
 * Stage 0 measured this: `createSandbox` runs once per submission, and
 * every delegate session of that submission runs inside it), mounts no
 * model (Flue forbids `useModel` in a delegate; the model policy rides
 * the `useSubagent` declaration's `model` field or inherits the parent's),
 * and mounts no skills (the definition's skill list is empty in v1 —
 * `AgentSkillPolicy` is the seam a future definition would fill).
 *
 * The instructions are the fixed prompt in `context/explore-prompt.ts`,
 * byte-identical per render, and that is the cache argument for a
 * delegate's composed system prompt the same way it is for studio's.
 *
 * What a delegate NEVER declares: another `useSubagent`. `delegates: []`
 * is the definition's recorded depth, and the render agreeing with it is
 * what makes the depth cap real — an explore task that could spawn an
 * explore task would be a delegation graph, not a delegation.
 */
export function Explore(_props: AgentProps) {
  return exploreDefinition.instructions;
}

/**
 * The durable identity, pinned as a literal. The registry resolves this
 * delegate by the definition's `identity.agentName` (validated at load to
 * equal `EXPLORE_AGENT_ID`'s contract), and the `useSubagent` declaration
 * in `agents/studio.ts` names the same string on the `task` tool's roster.
 */
Explore.agentName = "explore";

/**
 * The definition's numbers, read from the definition so the registry and
 * the runtime cannot disagree — the same single-source rule the four live
 * agents follow.
 */
Explore.durability = exploreDefinition.durability;
