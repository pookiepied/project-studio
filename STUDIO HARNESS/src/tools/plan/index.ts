import type { PlanItemWrite, PlanView } from "../../plan/plan.js";
import type { CallGate } from "../gate.js";
import { createPlanTool } from "./plan.js";

/**
 * The plan family: the run's stated intention, as rows a person can tick.
 *
 * A family of one, beside the ask family rather than inside it. The two are
 * alike in being a model-written channel the person answers through, and
 * unlike in every mechanic that matters: a question parks a call and expires,
 * a plan neither parks nor expires - it is the conversation's standing state,
 * which is why the dependency is a merge-and-read and not a waiting channel.
 */
export interface PlanToolRegistration {
  /** Merges the named items as the model, then reads the whole plan back. */
  readonly merge: (conversationId: string, items: readonly PlanItemWrite[]) => PlanView;
}

export function registerPlanTools(gate: CallGate, dependencies: PlanToolRegistration): void {
  gate.register(createPlanTool({ merge: dependencies.merge }));
}
