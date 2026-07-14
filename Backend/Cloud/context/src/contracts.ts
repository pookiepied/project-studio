export type RuntimeConsumer = "execution" | "planner" | "agent";
export type ResourceScope = "system" | "user";

export interface ResourceRef {
  id: string;
  kind: string;
  name: string;
  scope?: ResourceScope;
}

export interface ExecutionLimits {
  maxModelSteps?: number;
  maxWallClockMs?: number;
  maxTotalTokens?: number;
  maxToolCalls?: number;
}

export interface ContextPackage {
  userId: string;
  conversationId?: string;
  taskId: string;
  runtime: {
    consumer: RuntimeConsumer;
    systemPrompt: string;
    instructions: string[];
    limits: ExecutionLimits;
  };
  user: UserContext;
  project: ProjectContext;
  conversation: ConversationContext;
  connectors: ConnectorContext[];
  mcp: McpContext[];
  tools: StudioToolDescriptor[];
  skills: SkillContext[];
  agents: AgentContext[];
}

export interface UserContext {
  preferences: Record<string, string>;
  relevantMemories: string[];
  permissions: string[];
}

export interface ProjectContext {
  relevantFiles: string[];
  documentation: string[];
  workspace: {
    location: "cloud" | "local";
    available: boolean;
  };
}

export interface ConversationContext {
  currentMessage: string;
  relevantHistory: Array<{
    role: "system" | "user" | "assistant";
    content: string;
    createdAt: string;
  }>;
  priorToolResults: Array<{
    toolName: string;
    summary: string;
  }>;
  attachments: Array<{
    attachmentId: string;
    contentType: string;
    name: string;
  }>;
}

export interface ConnectorContext {
  ref: ResourceRef;
  authenticated: boolean;
  relevantTools: string[];
}

export interface McpContext {
  ref: ResourceRef;
  location: "cloud" | "local";
  available: boolean;
  relevantTools: string[];
}

export interface SkillContext {
  ref: ResourceRef;
  summary: string;
  activationHint?: string;
}

export interface AgentContext {
  ref: ResourceRef;
  description: string;
  location: "cloud" | "local";
  delegatable: boolean;
}

export interface StudioToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  family: "connector" | "native-cloud" | "user-mcp" | "native-local" | "client";
  target: "mcp-hub" | "local-relay" | "client";
  location: "cloud" | "local";
  capabilityRef: ResourceRef;
  policy: {
    effect?: "none" | "read" | "write" | "destructive";
    requiresApproval?: boolean;
  };
  route:
    | { kind: "native-cloud"; serviceId: string; toolName: string }
    | { kind: "remote-mcp"; serverId: string; toolName: string; endpoint: string }
    | { kind: "local-relay"; serverId: string; toolName: string; localRegistrationId?: string }
    | { kind: "connector"; slug: string; connectionId: string; entityId: string }
    | { kind: "client"; action: string };
}

export interface RegistryToolRecord {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

export interface RegistryMcpRecord {
  ref: ResourceRef;
  enabled: boolean;
  available: boolean;
  origin: string;
  location: "cloud" | "local";
  localRegistrationId?: string;
  metadata: Record<string, unknown>;
  tools: RegistryToolRecord[];
}

export interface RegistryConnectorRecord {
  ref: ResourceRef;
  enabled: boolean;
  available: boolean;
  authenticated: boolean;
  metadata: Record<string, unknown>;
  tools: RegistryToolRecord[];
}

export interface RegistrySkillRecord {
  ref: ResourceRef;
  enabled: boolean;
  available: boolean;
  description: string;
  activationRules: Record<string, unknown>;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  permissions: {
    delegation: boolean;
  };
  runtime: {
    location: "cloud" | "local";
  };
}
