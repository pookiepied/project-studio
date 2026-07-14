export interface ExecutionLimits {
  maxModelSteps?: number;
  maxWallClockMs?: number;
  maxTotalTokens?: number;
  maxToolCalls?: number;
}

export interface RunState {
  runId: string;
  conversationId: string;
  userId: string;
  request: string;
  modelId: string;
  idempotencyKey: string;
  branchId?: string;
  turnId: string;
  status: "running" | "completed" | "failed" | "cancelled" | "paused";
  createdAt: string;
  updatedAt: string;
  version: number;
  limits?: ExecutionLimits;
}

export interface ContextPackage {
  userId: string;
  conversationId?: string;
  taskId: string;
  runtime: {
    consumer: "execution" | "planner" | "agent";
    systemPrompt: string;
    instructions: string[];
    limits: ExecutionLimits;
  };
  tools: StudioToolDescriptor[];
}

export interface StudioToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  policy: {
    effect?: "none" | "read" | "write" | "destructive";
    requiresApproval?: boolean;
  };
}

export type ToolEffect = "none" | "read" | "write" | "destructive";

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
