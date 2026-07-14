import type { ResourceOwner, ResourceOwnerType } from "../../system/ownership";

export const mcpServerStatuses = ["draft", "active", "disabled", "archived"] as const;
export const mcpServerOrigins = ["studio", "third-party"] as const;
export const mcpTransports = ["streamable-http", "sse", "http"] as const;

export type McpServerStatus = (typeof mcpServerStatuses)[number];
export type McpServerOrigin = (typeof mcpServerOrigins)[number];
export type McpTransport = (typeof mcpTransports)[number];

export interface McpToolRecord {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  metadata: Record<string, unknown>;
}

export interface McpServerRecord extends ResourceOwner {
  id: string;
  name: string;
  slug: string;
  description: string;
  origin: McpServerOrigin;
  status: McpServerStatus;
  currentVersion: string;
  transport: McpTransport;
  endpointRef?: string;
  authRef?: string;
  configRef?: string;
  tools: McpToolRecord[];
  permissions: string[];
  tags: string[];
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface McpServerSearch {
  userId: string;
  query?: string;
  status?: McpServerStatus;
  origin?: McpServerOrigin;
  ownerType?: ResourceOwnerType;
  transport?: McpTransport;
  tag?: string;
  limit: number;
}
