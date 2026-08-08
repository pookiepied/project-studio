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
  sendable?: {
    format: "studio.context.projection.v1";
    sections: Array<{ id: string; stability: "stable" | "semi-stable" | "dynamic"; content: unknown }>;
    modelInput?: ProviderNeutralModelInput;
    toolNames: string[];
    defaultToolNames: string[];
    discoveryToolName?: "discover_tools";
    resolveToolName?: "resolve_tool";
    expansionToolName?: "discover_tools" | "expand_tool";
  };
  defaultTools?: StudioToolDescriptor[];
  tools: StudioToolDescriptor[];
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

export interface StudioToolDescriptor {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  family?: "connector" | "native-cloud" | "user-mcp" | "native-local" | "client" | "memory";
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
