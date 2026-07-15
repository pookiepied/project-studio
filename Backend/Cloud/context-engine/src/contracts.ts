export type RuntimeConsumer = "execution" | "planner" | "agent";
export type ResourceScope = "system" | "user";
export type CapabilityType = "mcp-server" | "mcp-tool" | "connector" | "skill" | "agent" | "native-tool" | "memory-tool" | "internal-tool";
export type CapabilityAvailability = "available" | "unavailable" | "disabled" | "unauthorized" | "disconnected";
export type ContextCacheStatus = "hit" | "miss" | "refreshed";

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
  workspaceId?: string;
  agentId?: string;
  conversationId?: string;
  taskId: string;
  contextEngine: ContextEngineMetadata;
  runtime: {
    consumer: RuntimeConsumer;
    systemPrompt: string;
    instructions: string[];
    limits: ExecutionLimits;
  };
  internal: InternalContextSummary;
  sendable: SendableContext;
  capabilityCatalog: CapabilitySummary[];
  defaultTools: StudioToolDescriptor[];
  user: UserContext;
  project: ProjectContext;
  conversation: ConversationContext;
  connectors: ConnectorContext[];
  mcp: McpContext[];
  tools: StudioToolDescriptor[];
  skills: SkillContext[];
  agents: AgentContext[];
}

export interface ContextEngineMetadata {
  service: "studio-context-engine";
  projectionId: string;
  cacheKey: string;
  cacheStatus: ContextCacheStatus;
  assembledAt: string;
  versions: {
    context: string;
    registry: string;
    memory: string;
    capability: string;
  };
}

export interface InternalContextSummary {
  capabilityCount: number;
  toolCount: number;
  defaultToolCount: number;
  memoryCategories: Array<"recent_memory" | "user_profile">;
  projection: RuntimeConsumer;
}

export interface SendableContext {
  format: "studio.context.projection.v1";
  sections: SendableSection[];
  modelInput: ProviderNeutralModelInput;
  toolNames: string[];
  defaultToolNames: string[];
  discoveryToolName: "discover_tools";
  resolveToolName: "resolve_tool";
  /** @deprecated Use discoveryToolName and resolveToolName. */
  expansionToolName: "discover_tools";
  serialization: {
    stablePrefixSections: string[];
    dynamicSections: string[];
    deterministic: true;
  };
}

export interface SendableSection {
  id: string;
  stability: "stable" | "semi-stable" | "dynamic";
  content: unknown;
}

export interface ProviderNeutralModelInput {
  format: "studio.model-input.v1";
  generatedAt: string;
  messages: ProviderNeutralMessage[];
  tools: ProviderNeutralToolSchema[];
  resources: ProviderNeutralResource[];
  cachePlan: {
    stablePrefixSectionIds: string[];
    semiStableSectionIds: string[];
    dynamicSectionIds: string[];
    currentTurnSectionIds: string[];
  };
  loweringHints: {
    images: "reference-only";
    files: "reference-only";
    artifacts: "summary-or-text";
    toolSchemas: "materialized-defaults-only";
  };
}

export interface ProviderNeutralMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  channel: "context" | "transcript" | "current_input";
  stability: "stable" | "semi-stable" | "dynamic";
  sourceSectionId: string;
  createdAt?: string;
  parts: ProviderNeutralMessagePart[];
}

export type ProviderNeutralMessagePart =
  | { kind: "text"; text: string; source?: string; truncated?: boolean }
  | { kind: "summary"; text: string; source?: string }
  | { kind: "image_ref"; resourceId: string; title?: string; contentType?: string }
  | { kind: "file_ref"; resourceId: string; title?: string; contentType?: string }
  | { kind: "artifact_ref"; artifactId: string; title: string; family?: string; type?: string; status?: string; summary?: string }
  | { kind: "attachment_ref"; attachmentId: string; title: string; contentType?: string; summary?: string }
  | { kind: "tool_call"; toolCallId?: string; toolName: string; inputSummary?: string }
  | { kind: "tool_result"; toolCallId?: string; toolName?: string; summary: string };

export interface ProviderNeutralResource {
  id: string;
  kind: "artifact" | "attachment";
  title: string;
  contentType?: string;
  status?: string;
  family?: string;
  type?: string;
  modelVisibility: "include" | "reference_only" | "omit";
  inlineMode: "reference" | "summary" | "text" | "image" | "file";
  hasInlineText: boolean;
}

export interface ProviderNeutralToolSchema {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  policy: StudioToolDescriptor["policy"];
}

export interface CapabilitySummary {
  id: string;
  type: CapabilityType;
  name: string;
  description: string;
  availability: CapabilityAvailability;
  scope: ResourceScope;
  source: string;
  expandable: boolean;
  executable: boolean;
  version?: string;
  category?: string;
  tags?: string[];
  toolName?: string;
  parentId?: string;
}

export interface ExpandToolRequest {
  userId: string;
  workspaceId?: string;
  agentId?: string;
  conversationId?: string;
  taskId?: string;
  task?: string;
  consumer: RuntimeConsumer;
  type?: CapabilityType | "all";
  name?: string;
  id?: string;
  category?: string;
}

export interface ExpandToolResponse {
  query: Omit<ExpandToolRequest, "userId" | "workspaceId" | "agentId" | "conversationId" | "taskId" | "task" | "consumer">;
  matches: CapabilityExpansion[];
}

export interface CapabilityExpansion {
  summary: CapabilitySummary;
  tool?: StudioToolDescriptor;
  details?: Record<string, unknown>;
}

export interface UserContext {
  preferences: Record<string, string>;
  relevantMemories: string[];
  memoryReferences: MemoryReference[];
  recentMemory: string[];
  userProfile: Record<string, string>;
  permissions: string[];
}

export interface MemoryReference {
  id: string;
  category: "recent_memory" | "user_profile" | "long_term_memory" | "task_memory";
  content: string;
  summary?: string;
  score?: number;
  source?: string;
  updatedAt?: string;
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
    role: "system" | "user" | "assistant" | "tool";
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
  contextReferences: Array<{
    id: string;
    kind: "artifact_reference" | "artifact_created" | "artifact_updated" | "artifact_completed" | "artifact_failed" | "artifact_permission_requested" | "attachment_reference" | "context_reference";
    summary: string;
  }>;
  resolvedResources: ResolvedContextResource[];
}

export interface ResolvedContextResource {
  id: string;
  kind: "artifact" | "attachment";
  sourceEventId?: string;
  conversationId?: string;
  title: string;
  summary?: string;
  contentType?: string;
  status?: string;
  family?: string;
  type?: string;
  inlineMode: "reference" | "summary" | "text" | "image" | "file";
  modelVisibility: "include" | "reference_only" | "omit";
  metadata: Record<string, unknown>;
  content?: {
    format: "text";
    text: string;
    truncated: boolean;
    contentType?: string;
  };
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
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  family: "connector" | "native-cloud" | "user-mcp" | "native-local" | "client" | "memory";
  target: "mcp-hub" | "local-relay" | "client";
  location: "cloud" | "local";
  capabilityRef: ResourceRef;
  policy: {
    effect?: "none" | "read" | "write" | "destructive";
    requiresApproval?: boolean;
  };
  route:
    | { kind: "agent-runtime"; action: string; agentId?: string }
    | { kind: "skill-library"; action: string }
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
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  enabled: boolean;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

export interface RegistryMcpRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  ownerType: ResourceScope;
  ownerUserId?: string;
  status: "draft" | "active" | "disabled" | "archived";
  origin: string;
  transport: "streamable-http" | "sse" | "http";
  endpointRef?: string;
  metadata: Record<string, unknown>;
  tools: RegistryToolRecord[];
}

export interface ConnectorToolRecord {
  slug: string;
  name: string;
  description: string;
  inputParameters: Record<string, unknown>;
  connectionId: string;
  entityId: string;
  appKey: string;
  displayName: string;
}

export interface ConnectorAppRecord {
  appName: string;
  displayName: string;
  tools: Array<{
    name: string;
    description: string;
  }>;
}

export interface RegistrySkillRecord {
  id: string;
  name: string;
  slug: string;
  description: string;
  ownerType: ResourceScope;
  status: "draft" | "active" | "disabled" | "archived";
  activationRules: Record<string, unknown>;
}

export interface AgentDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  ownerType: ResourceScope;
  status: "draft" | "active" | "disabled" | "archived";
  runtimeType: "agent-runtime";
}
