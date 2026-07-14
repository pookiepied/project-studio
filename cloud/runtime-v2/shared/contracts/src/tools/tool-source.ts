import type { ToolPolicy } from "../execution/policy";
import type { CapabilityRef, ExecutionLocation } from "../registry/capabilities";

/**
 * Product-facing tool families. These names describe where a capability belongs
 * in Studio, not necessarily where the final function call executes.
 */
export type StudioToolFamily =
  | "connector"
  | "native-cloud"
  | "native-local"
  | "user-mcp"
  | "client";

/**
 * Runtime execution adapters. Context/Registry choose these; Execution Runtime
 * only resolves the selected adapter and invokes it through the AI SDK.
 */
export type StudioToolExecutionTarget =
  | "mcp-hub"
  | "service-binding"
  | "local-relay"
  | "client";

export interface StudioToolDescriptor {
  /** Stable model-visible tool name. */
  name: string;
  description: string;
  /** JSON Schema object consumed by the AI SDK as the tool input schema. */
  inputSchema: Record<string, unknown>;
  family: StudioToolFamily;
  target: StudioToolExecutionTarget;
  location: ExecutionLocation;
  capabilityRef: CapabilityRef;
  policy?: Partial<ToolPolicy>;
  route: StudioToolRoute;
  metadata?: Record<string, unknown>;
}

export type StudioToolRoute =
  | ConnectorToolRoute
  | NativeCloudToolRoute
  | RemoteMcpToolRoute
  | LocalRelayToolRoute
  | ClientToolRoute;

/**
 * Connectors are the product name for Composio-backed app integrations
 * (Gmail, Drive, Slack, Calendar, etc.). Runtime executes them through the
 * Studio MCP hub; Composio details stay behind that boundary.
 */
export interface ConnectorToolRoute {
  kind: "connector";
  hubPath?: "/internal/composio/execute";
  slug: string;
  connectionId: string;
  entityId: string;
}

/**
 * First-party cloud tools served by Studio-owned workers, normally surfaced by
 * the MCP hub's native-service catalog: memory, web/search/RAG, media, skills.
 */
export interface NativeCloudToolRoute {
  kind: "native-cloud";
  serviceId: "memory" | "studio-tools" | "studio-skills" | "youtube-transcript" | string;
  toolName: string;
  hubPath?: "/internal/native/execute";
}

/** User-installed remote MCP server executed by the Studio MCP hub. */
export interface RemoteMcpToolRoute {
  kind: "remote-mcp";
  serverId: string;
  toolName: string;
  endpoint: string;
  authRef?: string;
  hubPath?: "/internal/remote/execute";
}

/**
 * Bundled desktop MCP servers. The cloud runtime emits a relay request and
 * waits for the frontend/local bridge to send the result back.
 */
export interface LocalRelayToolRoute {
  kind: "local-relay";
  serverId: "studio-harness" | "computer-use" | string;
  toolName: string;
  localRegistrationId?: string;
}

/**
 * Frontend-native actions that are not real cloud tools, such as updating a
 * visible task list. These should stay rare and explicit.
 */
export interface ClientToolRoute {
  kind: "client";
  action: string;
}
