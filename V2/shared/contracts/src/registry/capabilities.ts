/**
 * Normalized capability model shared by Studio Registry and Studio Context.
 * The registry answers "what exists"; these types are its public shape.
 */

export type CapabilityKind = "connector" | "mcp-server" | "bundle" | "skill" | "agent";

export type ExecutionLocation = "cloud" | "local";

export type CapabilityOrigin = "studio" | "user" | "third-party";

/** Stable reference to a registered capability, always scoped to one user. */
export interface CapabilityRef {
  id: string;
  kind: CapabilityKind;
  name: string;
}

export interface CapabilityRecord {
  ref: CapabilityRef;
  userId: string;
  origin: CapabilityOrigin;
  location: ExecutionLocation;
  enabled: boolean;
  available: boolean;
  version?: string;
  permissions: string[];
  /** References only — credentials never pass through the registry. */
  configRef?: string;
  metadata: Record<string, unknown>;
}

export interface RegisteredToolMetadata {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  enabled: boolean;
  permissions?: string[];
  metadata?: Record<string, unknown>;
}

export type McpTransport = "stdio" | "streamable-http" | "sse" | "websocket";

export interface RegistryMcpRecord extends CapabilityRecord {
  ref: CapabilityRef & { kind: "mcp-server" };
  transport: McpTransport;
  tools: RegisteredToolMetadata[];
  /** Opaque local identifier. Endpoints, commands, headers, and secrets are never synchronized. */
  localRegistrationId?: string;
  verifiedAt?: string;
}

export interface RegistryConnectorRecord extends CapabilityRecord {
  ref: CapabilityRef & { kind: "connector" };
  authenticated: boolean;
  tools: RegisteredToolMetadata[];
}

export interface RegistryBundleRecord extends CapabilityRecord {
  ref: CapabilityRef & { kind: "bundle" };
  bundleType: string;
  runtime: string;
  tools: RegisteredToolMetadata[];
}

export interface RegistrySkillRecord extends CapabilityRecord {
  ref: CapabilityRef & { kind: "skill" };
  description: string;
  instructionsRef?: string;
  requiredTools: string[];
  requiredPermissions: string[];
  environments: string[];
  activationRules: Record<string, unknown>;
  resources: string[];
}

/** Sanitized desktop-to-cloud payload. It intentionally cannot represent secrets or endpoints. */
export interface LocalRegistrySyncRequest {
  userId: string;
  machineId: string;
  revision: number;
  mcpServers: RegistryMcpRecord[];
  bundles: RegistryBundleRecord[];
  /** Sanitized metadata only; skill bodies remain local or behind instructionsRef. */
  skills?: RegistrySkillRecord[];
}

export interface RegistrySnapshot {
  revision: number;
  connectors: RegistryConnectorRecord[];
  mcpServers: RegistryMcpRecord[];
  bundles: RegistryBundleRecord[];
  skills?: RegistrySkillRecord[];
}
