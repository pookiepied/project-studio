'use agent';

import { useSkill, type AgentProps } from "@flue/runtime";

import { currentExecutionContext } from "../execution/context.js";
import { getStudioRuntime } from "../application/studio-runtime.js";
import { planDefinition } from "./definitions/plan.js";

/**
 * The planning delegate (ADR 0058 D11, Stage 5).
 *
 * Same registration story as `Explore` and `General`: Flue resolves
 * delegates by function, the `'use agent'` directive keeps the architecture
 * test's roster rule covering this module, and the render composes the
 * definition plus the S5.3 skills intersection — resolved per render from
 * the parent conversation's selection chain (the child's frame carries the
 * parent's instance id), empty in v1 for this definition, mounted through
 * the loop any future named-skill definition would ride.
 *
 * What this delegate's session IS, beyond the instructions: the plan tool
 * reaches it through the gate's per-acting-agent filter (its allowlist
 * names `plan`; the store records its rows under `agent:plan`), and its
 * final message returns to the parent as the task tool's result. It
 * declares no `useSubagent` of its own; it mounts no sandbox and no model.
 */
export function Plan(_props: AgentProps) {
  const runtime = getStudioRuntime();
  const conversationId = currentExecutionContext()?.flueInstanceId;
  for (const skill of runtime.delegateSkills?.(conversationId, planDefinition) ?? []) {
    useSkill(skill);
  }
  return planDefinition.instructions;
}

/**
 * The durable identity, pinned as a literal and asserted equal to
 * `PLAN_AGENT_ID` in the registry suite.
 */
Plan.agentName = "plan";

/** The definition's numbers — the single-source rule every agent follows. */
Plan.durability = planDefinition.durability;
