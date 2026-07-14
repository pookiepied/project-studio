export type McpServerOwnerType = "system" | "user";
export type McpServerStatus = "draft" | "active" | "disabled" | "archived";
export type McpServerTransport = "streamable-http" | "sse" | "http";

export interface McpServerOwner {
  type: McpServerOwnerType;
  userId?: string;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface McpServerDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  status: McpServerStatus;
  owner: McpServerOwner;
  transport: McpServerTransport;
  endpointRef?: string;
  authRef?: string;
  configRef: string;
  tools: McpToolDefinition[];
  permissions: string[];
  tags: string[];
  metadata: Record<string, unknown>;
}
