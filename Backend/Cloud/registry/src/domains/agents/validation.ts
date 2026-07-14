import { badRequest } from "../../errors/appError";
import { readOwner } from "../../system/ownership";
import { oneOf, optionalObject, optionalString, optionalStringArray, requireString } from "../../system/validation";
import { agentOrigins, agentRuntimeTypes, agentStatuses, type AgentCapabilitySummary, type AgentRegistration, type AgentSearch } from "./types";

export function normalizeAgentRegistrationCreate(body: unknown): AgentRegistration {
  const input = readObject(body);
  const name = requireString(input.name, "name");
  const owner = readOwner(input, { allowUserOwned: true });
  return {
    ...owner,
    id: optionalString(input.id, "id") ?? crypto.randomUUID(),
    name,
    slug: optionalString(input.slug, "slug") ?? toSlug(name),
    description: optionalString(input.description, "description") ?? "",
    origin: input.origin === undefined ? "studio" : oneOf(input.origin, agentOrigins, "origin"),
    status: input.status === undefined ? "draft" : oneOf(input.status, agentStatuses, "status"),
    version: optionalString(input.version, "version") ?? "0.1.0",
    runtimeType: input.runtimeType === undefined ? "agent-runtime" : oneOf(input.runtimeType, agentRuntimeTypes, "runtimeType"),
    definitionRef: requireString(input.definitionRef, "definitionRef"),
    capabilitySummary: normalizeCapabilitySummary(input.capabilitySummary),
    scheduleEnabled: typeof input.scheduleEnabled === "boolean" ? input.scheduleEnabled : false,
    metadata: optionalObject(input.metadata, "metadata"),
    createdAt: "",
    updatedAt: "",
  };
}

export function normalizeAgentRegistrationPatch(current: AgentRegistration, body: unknown): AgentRegistration {
  const input = readObject(body);
  const name = optionalString(input.name, "name") ?? current.name;
  return {
    ...current,
    name,
    slug: optionalString(input.slug, "slug") ?? (input.name ? toSlug(name) : current.slug),
    description: optionalString(input.description, "description") ?? current.description,
    origin: input.origin === undefined ? current.origin : oneOf(input.origin, agentOrigins, "origin"),
    status: input.status === undefined ? current.status : oneOf(input.status, agentStatuses, "status"),
    version: optionalString(input.version, "version") ?? current.version,
    runtimeType: input.runtimeType === undefined ? current.runtimeType : oneOf(input.runtimeType, agentRuntimeTypes, "runtimeType"),
    definitionRef: optionalString(input.definitionRef, "definitionRef") ?? current.definitionRef,
    capabilitySummary:
      input.capabilitySummary === undefined ? current.capabilitySummary : normalizeCapabilitySummary(input.capabilitySummary),
    scheduleEnabled: typeof input.scheduleEnabled === "boolean" ? input.scheduleEnabled : current.scheduleEnabled,
    metadata: input.metadata === undefined ? current.metadata : optionalObject(input.metadata, "metadata"),
  };
}

export function parseAgentSearch(url: URL, userId: string): AgentSearch {
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest("limit must be between 1 and 100.");
  const status = url.searchParams.get("status");
  const origin = url.searchParams.get("origin");
  const ownerType = url.searchParams.get("ownerType");
  const runtimeType = url.searchParams.get("runtimeType");

  return {
    userId,
    query: url.searchParams.get("q") ?? undefined,
    status: status ? oneOf(status, agentStatuses, "status") : undefined,
    origin: origin ? oneOf(origin, agentOrigins, "origin") : undefined,
    ownerType: ownerType ? oneOf(ownerType, ["system", "user"] as const, "ownerType") : undefined,
    runtimeType: runtimeType ? oneOf(runtimeType, agentRuntimeTypes, "runtimeType") : undefined,
    limit,
  };
}

function normalizeCapabilitySummary(value: unknown): AgentCapabilitySummary {
  const input = optionalObject(value, "capabilitySummary");
  return {
    mcpServers: optionalStringArray(input.mcpServers, "capabilitySummary.mcpServers"),
    skills: optionalStringArray(input.skills, "capabilitySummary.skills"),
    nativeTools: optionalStringArray(input.nativeTools, "capabilitySummary.nativeTools"),
    memoryScopes: optionalStringArray(input.memoryScopes, "capabilitySummary.memoryScopes"),
  };
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw badRequest("Request body must be an object.");
  return value as Record<string, unknown>;
}

function toSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
