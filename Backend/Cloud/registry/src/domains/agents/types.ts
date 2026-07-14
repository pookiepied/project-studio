import type { ResourceOwner, ResourceOwnerType } from "../../system/ownership";

export const agentStatuses = ["draft", "active", "disabled", "archived"] as const;
export const agentOrigins = ["studio", "third-party"] as const;
export const agentRuntimeTypes = ["agent-runtime"] as const;

export type AgentStatus = (typeof agentStatuses)[number];
export type AgentOrigin = (typeof agentOrigins)[number];
export type AgentRuntimeType = (typeof agentRuntimeTypes)[number];

export interface AgentCapabilitySummary {
  mcpServers: string[];
  skills: string[];
  nativeTools: string[];
  memoryScopes: string[];
}

export interface AgentRegistration extends ResourceOwner {
  id: string;
  name: string;
  slug: string;
  description: string;
  origin: AgentOrigin;
  status: AgentStatus;
  version: string;
  runtimeType: AgentRuntimeType;
  definitionRef: string;
  capabilitySummary: AgentCapabilitySummary;
  scheduleEnabled: boolean;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface AgentDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  status: AgentStatus;
  runtimeType: AgentRuntimeType;
  definitionRef: string;
  systemPrompt: string;
  access: {
    mcpServers: string[];
    skills: string[];
    nativeTools: string[];
    memoryScopes: string[];
  };
  permissions: {
    allowedActions: string[];
    deniedActions: string[];
    requiresApprovalFor: string[];
  };
  runtime: {
    maxSteps: number;
    timeoutMs: number;
    maxToolCalls: number;
  };
  io: {
    inputSchema?: Record<string, unknown>;
    outputSchema?: Record<string, unknown>;
    outputFormat: "text" | "markdown" | "json" | "report";
  };
  scheduling: {
    enabled: boolean;
    cron?: string;
    timezone?: string;
  };
  metadata: Record<string, unknown>;
}

export interface AgentSearch {
  userId: string;
  query?: string;
  status?: AgentStatus;
  origin?: AgentOrigin;
  ownerType?: ResourceOwnerType;
  runtimeType?: AgentRuntimeType;
  limit: number;
}
