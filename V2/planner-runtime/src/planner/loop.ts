import type { ContextPackage, Plan } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * The planning loop (ARCHITECTURE.md §4). Loop model is open decision #2
 * (custom loop / ReAct with read-only tools / staged workflow / hybrid);
 * this interface stays stable regardless of which is chosen.
 */

export interface PlanningInput {
  goal: string;
  context: ContextPackage;
}

export async function runPlanningLoop(
  _env: Env,
  _input: PlanningInput,
): Promise<Plan> {
  throw new Error("not_implemented");
}
