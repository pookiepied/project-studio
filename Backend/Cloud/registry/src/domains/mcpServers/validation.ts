import { badRequest } from "../../errors/appError";
import { readOwner } from "../../system/ownership";
import { oneOf, optionalObject, optionalString, optionalStringArray, requireString } from "../../system/validation";
import {
  mcpServerOrigins,
  mcpServerStatuses,
  mcpTransports,
  type McpServerRecord,
  type McpServerSearch,
  type McpToolRecord,
} from "./types";

export function normalizeMcpServerCreate(body: unknown): McpServerRecord {
  const input = readObject(body);
  const name = requireString(input.name, "name");
  const owner = readOwner(input, { allowUserOwned: true });

  return {
    ...owner,
    id: optionalString(input.id, "id") ?? crypto.randomUUID(),
    name,
    slug: optionalString(input.slug, "slug") ?? toSlug(name),
    description: optionalString(input.description, "description") ?? "",
    origin: input.origin === undefined ? "studio" : oneOf(input.origin, mcpServerOrigins, "origin"),
    status: input.status === undefined ? "draft" : oneOf(input.status, mcpServerStatuses, "status"),
    currentVersion: optionalString(input.currentVersion ?? input.version, "currentVersion") ?? "0.1.0",
    transport: input.transport === undefined ? "streamable-http" : oneOf(input.transport, mcpTransports, "transport"),
    endpointRef: optionalString(input.endpointRef, "endpointRef"),
    authRef: optionalString(input.authRef, "authRef"),
    configRef: optionalString(input.configRef, "configRef"),
    tools: normalizeTools(input.tools),
    permissions: optionalStringArray(input.permissions, "permissions"),
    tags: optionalStringArray(input.tags, "tags"),
    metadata: optionalObject(input.metadata, "metadata"),
    createdAt: "",
    updatedAt: "",
  };
}

export function normalizeMcpServerPatch(current: McpServerRecord, body: unknown): McpServerRecord {
  const input = readObject(body);
  const name = optionalString(input.name, "name") ?? current.name;
  return {
    ...current,
    name,
    slug: optionalString(input.slug, "slug") ?? (input.name ? toSlug(name) : current.slug),
    description: optionalString(input.description, "description") ?? current.description,
    origin: input.origin === undefined ? current.origin : oneOf(input.origin, mcpServerOrigins, "origin"),
    status: input.status === undefined ? current.status : oneOf(input.status, mcpServerStatuses, "status"),
    currentVersion: optionalString(input.currentVersion ?? input.version, "currentVersion") ?? current.currentVersion,
    transport: input.transport === undefined ? current.transport : oneOf(input.transport, mcpTransports, "transport"),
    endpointRef: optionalString(input.endpointRef, "endpointRef") ?? current.endpointRef,
    authRef: optionalString(input.authRef, "authRef") ?? current.authRef,
    configRef: optionalString(input.configRef, "configRef") ?? current.configRef,
    tools: input.tools === undefined ? current.tools : normalizeTools(input.tools),
    permissions: input.permissions === undefined ? current.permissions : optionalStringArray(input.permissions, "permissions"),
    tags: input.tags === undefined ? current.tags : optionalStringArray(input.tags, "tags"),
    metadata: input.metadata === undefined ? current.metadata : optionalObject(input.metadata, "metadata"),
  };
}

export function parseMcpServerSearch(url: URL, userId: string): McpServerSearch {
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest("limit must be between 1 and 100.");
  const status = url.searchParams.get("status");
  const origin = url.searchParams.get("origin");
  const ownerType = url.searchParams.get("ownerType");
  const transport = url.searchParams.get("transport");
  return {
    userId,
    query: url.searchParams.get("q") ?? undefined,
    status: status ? oneOf(status, mcpServerStatuses, "status") : undefined,
    origin: origin ? oneOf(origin, mcpServerOrigins, "origin") : undefined,
    ownerType: ownerType ? oneOf(ownerType, ["system", "user"] as const, "ownerType") : undefined,
    transport: transport ? oneOf(transport, mcpTransports, "transport") : undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    limit,
  };
}

export function mcpChangeNote(body: unknown): string | undefined {
  return optionalString(readObject(body).changeNote, "changeNote");
}

function normalizeTools(value: unknown): McpToolRecord[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest("tools must be an array.");
  return value.map((item, index) => {
    const tool = readObject(item);
    return {
      name: requireString(tool.name, `tools[${index}].name`),
      description: optionalString(tool.description, `tools[${index}].description`) ?? "",
      inputSchema: optionalObject(tool.inputSchema, `tools[${index}].inputSchema`),
      enabled: typeof tool.enabled === "boolean" ? tool.enabled : true,
      metadata: optionalObject(tool.metadata, `tools[${index}].metadata`),
    };
  });
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw badRequest("Request body must be an object.");
  return value as Record<string, unknown>;
}

function toSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
