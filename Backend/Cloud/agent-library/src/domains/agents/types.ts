export type AgentOwnerType = "system" | "user";
export type AgentStatus = "draft" | "active" | "disabled" | "archived";
export type AgentRuntimeType = "agent-runtime";
export type AgentOutputFormat = "text" | "markdown" | "json" | "report";

export interface AgentDefinition {
  id: string;
  owner: {
    type: AgentOwnerType;
    userId?: string | null;
  };
  identity: {
    name: string;
    slug: string;
    description: string;
  };
  version: string;
  status: AgentStatus;
  runtimeType: AgentRuntimeType;
  definitionRef: string;
  prompt: {
    system: string;
  };
  permissions: {
    allowedActions: string[];
    deniedActions: string[];
    requiresApprovalFor: string[];
  };
  access: {
    mcpServers: string[];
    skills: string[];
    nativeTools: string[];
    memory: {
      scopes: string[];
      read: boolean;
      write: boolean;
    };
  };
  runtime: {
    maxSteps: number;
    timeoutMs: number;
    maxToolCalls: number;
    executionPolicy: {
      allowDelegation: boolean;
      allowScheduling: boolean;
      requireHumanApproval: boolean;
    };
  };
  io: {
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    outputFormat: AgentOutputFormat;
  };
  scheduling: {
    enabled: boolean;
    cron?: string | null;
    timezone?: string | null;
  };
  metadata: Record<string, unknown>;
}
