/**
 * The context package is the unit of transfer from Studio Context to an agent
 * runtime (Execution, Planner, or Agent Runtime). It is structured, compact,
 * permission-aware, and specific to one task. Layers map to ARCHITECTURE.md §19.
 */

import type { CapabilityRef, ExecutionLocation } from "../registry/capabilities";
import type { ExecutionLimits } from "../execution/policy";
import type { StudioToolDescriptor } from "../tools/tool-source";

export type RuntimeConsumer = "execution" | "planner" | "agent";

export interface ContextPackage {
  userId: string;
  conversationId?: string;
  taskId: string;
  runtime: RuntimeContext;
  conversation: ConversationContext;
  connectors: ConnectorContext[];
  mcp: McpContext[];
  /** Task-scoped tools selected by Studio Context from Registry/connectors/MCP. */
  tools: StudioToolDescriptor[];
  skills: SkillContext[];
  agents: AgentContext[];
  user: UserContext;
  project: ProjectContext;
}

/**
 * Runtime-facing instructions and execution profile selected by Studio
 * Context for this task. The runtime may consume this; it must not build it by
 * scanning registries, buckets, uploads, or conversation storage itself.
 */
export interface RuntimeContext {
  consumer: RuntimeConsumer;
  /** Main behavioral prompt for the selected runtime/agent. */
  systemPrompt: string;
  /** Additional task-scoped instructions assembled by Context. */
  instructions: string[];
  /** Optional safety rails. Undefined fields mean unlimited. */
  limits?: ExecutionLimits;
}

export interface ConversationContext {
  currentMessage: string;
  /** Relevant prior messages only — never the full raw history. */
  relevantHistory: ContextMessage[];
  priorToolResults: ContextToolResult[];
  attachments: ContextAttachmentRef[];
}

export interface ContextMessage {
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

export interface ContextToolResult {
  toolName: string;
  summary: string;
}

export interface ContextAttachmentRef {
  /** Studio Data attachment id — content is fetched from Studio Data, not inlined. */
  attachmentId: string;
  contentType: string;
  name: string;
}

export interface ConnectorContext {
  ref: CapabilityRef;
  authenticated: boolean;
  /** Tool names the connector exposes that are relevant to this task. */
  relevantTools: string[];
}

export interface McpContext {
  ref: CapabilityRef;
  location: ExecutionLocation;
  available: boolean;
  relevantTools: string[];
}

export interface SkillContext {
  ref: CapabilityRef;
  summary: string;
  /** Full instructions are loaded progressively, only when activated. */
  instructions?: string;
}

export interface AgentContext {
  ref: CapabilityRef;
  description: string;
  location: ExecutionLocation;
  delegatable: boolean;
}

export interface UserContext {
  preferences: Record<string, string>;
  relevantMemories: string[];
  permissions: string[];
}

export interface ProjectContext {
  relevantFiles: ContextFileRef[];
  documentation: string[];
  workspace?: { location: ExecutionLocation; available: boolean };
}

export interface ContextFileRef {
  path: string;
  summary?: string;
}
