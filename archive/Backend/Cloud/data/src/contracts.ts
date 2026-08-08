export interface PlanStep {
  stepId: string;
  instruction: string;
  expectedResources: string[];
}

export interface PlanPhase {
  phaseId: string;
  title: string;
  description: string;
  steps: PlanStep[];
}

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
