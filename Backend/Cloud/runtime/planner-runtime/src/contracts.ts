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
  workspaceId?: string;
  agentId?: string;
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
  family?: "connector" | "native-cloud" | "user-mcp" | "native-local" | "client";
  target?: "mcp-hub" | "local-relay" | "client";
  location?: "cloud" | "local";
  policy: {
    effect?: "none" | "read" | "write" | "destructive";
    requiresApproval?: boolean;
  };
  route?: StudioToolRoute;
}

export type ToolEffect = "none" | "read" | "write" | "destructive";

export type StudioToolRoute =
  | { kind: "agent-runtime"; action: string; agentId?: string }
  | { kind: "skill-library"; action: string }
  | { kind: "native-cloud"; serviceId: string; toolName: string }
  | { kind: "remote-mcp"; serverId: string; toolName: string; endpoint: string }
  | { kind: "mcp-server"; serverId: string; endpoint: string; toolName?: string }
  | { kind: "local-relay"; serverId: string; toolName: string; localRegistrationId?: string }
  | { kind: "connector"; slug: string; connectionId: string; entityId: string }
  | { kind: "memory"; operation: string; location?: "cloud" | "local" }
  | { kind: "client"; action: string };

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
