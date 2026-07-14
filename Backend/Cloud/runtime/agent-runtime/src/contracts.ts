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

export interface AgentPermissions {
  read: boolean;
  write: boolean;
  delegation: boolean;
  tools: string[];
  allowedConnectors: string[];
  allowedMcpServers: string[];
  allowedSkills: string[];
}

export interface AgentLimits {
  maxSteps?: number;
  maxDurationMs?: number;
  maxTokens?: number;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  systemPrompt: string;
  personality?: string;
  outputFormat?: "text" | "json" | "structured";
  modelPreference?: string;
  permissions: AgentPermissions;
  limits?: AgentLimits;
  runtime: {
    location: "cloud" | "local";
  };
}

export interface DelegationResult {
  agentId: string;
  status: "completed" | "failed" | "cancelled";
  output: string;
  error?: string;
}
