export type SourceRuntime = "execution" | "planner" | "agent";
export type ToolJobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type ToolRoute =
  | { kind: "agent-runtime"; action: AgentToolAction; agentId?: string }
  | { kind: "skill-library"; action: SkillToolAction }
  | { kind: "mcp-server"; serverId: string; endpoint: string; toolName?: string }
  | { kind: "remote-mcp"; serverId: string; endpoint: string; toolName?: string }
  | { kind: "native-cloud"; serviceId: string; toolName: string }
  | { kind: "local-relay"; serverId: string; toolName: string; localRegistrationId?: string }
  | { kind: "connector"; slug: string; connectionId: string; entityId: string }
  | { kind: "memory"; operation: string; location?: "cloud" | "local" };

export type AgentToolAction =
  | "spawn_agent"
  | "await_agent"
  | "get_agent_status"
  | "report_back"
  | "read_agent_result"
  | "cancel_agent";

export type SkillToolAction =
  | "skill_list"
  | "skill_search"
  | "skill_get"
  | "skill_read"
  | "skill_read_resource"
  | "skill_resolve";

export interface ToolExecutionScope {
  userId: string;
  sessionId?: string;
  conversationId?: string;
  agentExecutionId?: string;
  parentExecutionId?: string;
  toolCallId: string;
  jobId?: string;
  idempotencyKey?: string;
  sourceRuntime: SourceRuntime;
}

export interface ToolExecutionRequest extends ToolExecutionScope {
  toolName: string;
  arguments: Record<string, unknown>;
  route?: ToolRoute;
  timeoutMs?: number;
  metadata?: Record<string, unknown>;
}

export interface ToolExecutionBatchRequest {
  userId: string;
  sourceRuntime: SourceRuntime;
  sessionId?: string;
  conversationId?: string;
  agentExecutionId?: string;
  parentExecutionId?: string;
  calls: ToolExecutionRequest[];
}

export interface ToolExecutionSuccess {
  ok: true;
  jobId: string;
  toolCallId: string;
  toolName: string;
  status: "completed";
  result: unknown;
  route: ToolRoute;
  startedAt: string;
  completedAt: string;
}

export interface ToolExecutionFailure {
  ok: false;
  jobId: string;
  toolCallId: string;
  toolName: string;
  status: "failed";
  error: ToolExecutionError;
  route?: ToolRoute;
  startedAt: string;
  completedAt: string;
}

export interface ToolExecutionError {
  code: string;
  message: string;
  retryable: boolean;
  details?: unknown;
}

export type ToolExecutionResult = ToolExecutionSuccess | ToolExecutionFailure;

export interface ToolExecutionJobRecord {
  jobId: string;
  userId: string;
  sessionId?: string;
  conversationId?: string;
  agentExecutionId?: string;
  toolCallId: string;
  sourceRuntime: SourceRuntime;
  toolName: string;
  status: ToolJobStatus;
  routeKind?: string;
  targetRef?: string;
  idempotencyKey?: string;
  request: ToolExecutionRequest;
  result?: unknown;
  error?: ToolExecutionError;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt: string;
}
