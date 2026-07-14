/**
 * Structured JSON agent definition (ARCHITECTURE.md §13, §15).
 * Stored by Studio Registry, executed by Studio Agent Runtime.
 * Schema is provisional until open decision #4/#5 is resolved.
 */

import type { ExecutionLocation } from "../registry/capabilities";

export interface AgentDefinition {
  id: string;
  userId: string;
  origin: "studio" | "user";
  name: string;
  description: string;
  version: string;
  enabled: boolean;
  systemPrompt: string;
  modelPreference?: string;
  personality?: string;
  permissions: AgentPermissions;
  limits: AgentLimits;
  schedule?: AgentSchedule;
  runtime: AgentRuntimeRequirements;
  outputFormat?: "text" | "json" | "structured";
}

export interface AgentPermissions {
  tools: string[];
  read: boolean;
  write: boolean;
  allowedConnectors: string[];
  allowedMcpServers: string[];
  allowedSkills: string[];
  /** Whether this agent may delegate to other agents. */
  delegation: boolean;
}

export interface AgentLimits {
  maxSteps?: number;
  maxDurationMs?: number;
  maxTokens?: number;
}

export interface AgentSchedule {
  cron: string;
  timezone?: string;
}

export interface AgentRuntimeRequirements {
  location: ExecutionLocation;
}

/** What a parent runtime hands to a delegated agent (ARCHITECTURE.md §17). */
export interface DelegationRequest {
  agentId: string;
  task: string;
  /** Scoped context only — never the entire parent conversation. */
  context: string;
  permissions: Partial<AgentPermissions>;
  expectedOutput?: string;
  limits?: AgentLimits;
}

export interface DelegationResult {
  agentId: string;
  status: "completed" | "failed" | "cancelled";
  output: string;
  failureSummary?: string;
}
