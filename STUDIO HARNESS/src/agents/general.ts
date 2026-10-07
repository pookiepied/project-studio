'use agent';

import { useSkill, type AgentProps } from "@flue/runtime";

import { currentExecutionContext } from "../execution/context.js";
import { getStudioRuntime } from "../application/studio-runtime.js";
import { generalDefinition } from "./definitions/general.js";

/**
 * The hands-on delegate (ADR 0058 D11, Stage 5).
 *
 * This module exists because Flue registers delegates by function: the
 * `task` tool's roster is a `useSubagent` declaration in the PARENT's
 * render, and the function it names is what runs when the parent's model
 * calls `task`. The `'use agent'` directive is here deliberately, as on
 * `Explore`, so the architecture test's rule (every capitalized export of a
 * `'use agent'` module is a registered agent) keeps this module from
 * drifting out of the registry's `byKind("delegate")` roster.
 *
 * What this render composes is the definition, plus the one live thing the
 * definition names: the skills intersection (S5.3). The delegate mounts no
 * sandbox (it shares the parent's already-built environment), no model
 * (`useModel` inside a delegate render is Flue-forbidden; the mount's
 * `model` field carries the policy, and `{ inherit: true }` mounts as
 * omitted), and declares no `useSubagent` of its own — a delegate that
 * could delegate would be a graph, and the definitions' recorded depth is
 * zero for every one of them.
 *
 * The skills are resolved per render from the conversation the task runs
 * inside: the child's execution-context frame carries the parent's instance
 * id (delegates ride the parent's instance — ADR 0058 §3), which is the
 * conversation id the selection chain is keyed by. The runtime intersects
 * that chain with the definition's named skills; for this definition the
 * list is empty in v1, so the loop mounts nothing — but it is the shape any
 * future definition with named skills mounts through, and an empty list is
 * the honest answer rather than the loop's absence.
 */
export function General(_props: AgentProps) {
  const runtime = getStudioRuntime();
  const conversationId = currentExecutionContext()?.flueInstanceId;
  for (const skill of runtime.delegateSkills?.(conversationId, generalDefinition) ?? []) {
    useSkill(skill);
  }
  return generalDefinition.instructions;
}

/**
 * The durable identity, pinned as a literal and asserted equal to
 * `GENERAL_AGENT_ID` in the registry suite.
 */
General.agentName = "general";

/**
 * The definition's numbers, read from the definition so the registry and
 * the runtime cannot disagree — the single-source rule every agent follows.
 */
General.durability = generalDefinition.durability;
