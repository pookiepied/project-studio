/**
 * The plan is the Planner Runtime's output contract: structured instructions
 * the Execution Runtime can act on (ARCHITECTURE.md §4).
 */

export interface Plan {
  planId: string;
  userId: string;
  goal: string;
  requirements: string[];
  constraints: string[];
  risks: string[];
  dependencies: string[];
  phases: PlanPhase[];
  openQuestions: string[];
  createdAt: string;
}

export interface PlanPhase {
  phaseId: string;
  title: string;
  description: string;
  steps: PlanStep[];
}

export interface PlanStep {
  stepId: string;
  instruction: string;
  /** Files, tools, or capabilities the executor is expected to need. */
  expectedResources: string[];
}
