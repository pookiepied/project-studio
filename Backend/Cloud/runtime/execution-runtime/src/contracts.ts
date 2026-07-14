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
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  policy: {
    effect?: "none" | "read" | "write" | "destructive";
    requiresApproval?: boolean;
  };
}

export type ToolEffect = "none" | "read" | "write" | "destructive";
