export type RuntimeConsumer = "execution" | "planner" | "agent";
export type ResourceScope = "system" | "user";
export type CapabilityType = "mcp-server" | "mcp-tool" | "connector" | "skill" | "agent" | "native-tool" | "memory-tool" | "internal-tool";
export type CapabilityAvailability = "available" | "unavailable" | "disabled" | "unauthorized" | "disconnected";
export type ToolTier = "default" | "summary" | "materialized";
export type ToolEligibilityStatus = "eligible" | "ineligible";

export interface SourceHealth {
  source: "registry" | "connectors" | "tool-pool";
  status: "available" | "degraded" | "unavailable";
  checkedAt: string;
  detail?: string;
}

export interface ToolPoolScope {
  userId: string;
  workspaceId?: string;
  conversationId?: string;
  agentId?: string;
  task?: string;
  consumer: RuntimeConsumer;
}

export interface ResourceRef {
  id: string;
  kind: string;
  name: string;
  scope?: ResourceScope;
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
  tier: ToolTier;
  eligibility: ToolEligibilityStatus;
  ineligibleReason?: string;
  conflict?: {
    canonicalName: string;
    strategy: "unchanged" | "namespaced" | "shadowed";
  };
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
    | { kind: "memory"; operation: string; location?: "cloud" | "local" }
    | { kind: "client"; action: string };
}

export interface ToolPoolProjection {
  format: "studio.tool-pool.projection.v1";
  scope: ToolPoolScope;
  generatedAt: string;
  sourceHealth: SourceHealth[];
  defaultTools: StudioToolDescriptor[];
  summaries: CapabilitySummary[];
}

export interface ToolDiscoveryRequest extends ToolPoolScope {
  query?: string;
  type?: CapabilityType | "all";
  category?: string;
  id?: string;
  name?: string;
  limit?: number;
}

export interface ToolDiscoveryResponse {
  format: "studio.tool-pool.discovery.v1";
  query: Omit<ToolDiscoveryRequest, "userId" | "workspaceId" | "conversationId" | "agentId" | "task" | "consumer">;
  matches: CapabilitySummary[];
}

export interface ToolResolveRequest extends ToolPoolScope {
  id?: string;
  name?: string;
  type?: CapabilityType;
}

export interface ToolResolveResponse {
  format: "studio.tool-pool.resolve.v1";
  matches: Array<{
    summary: CapabilitySummary;
    tool?: StudioToolDescriptor;
    details?: Record<string, unknown>;
  }>;
}
