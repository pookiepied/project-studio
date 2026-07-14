import { badRequest } from "../../errors/appError";
import { readOwner } from "../../system/ownership";
import { oneOf, optionalObject, optionalString, optionalStringArray, requireString } from "../../system/validation";
import { skillOrigins, skillStatuses, type SkillRecord, type SkillSearch } from "./types";

export function normalizeSkillCreate(body: unknown): SkillRecord {
  const input = readObject(body);
  const name = requireString(input.name, "name");
  const owner = readOwner(input, { allowUserOwned: true });

  return {
    ...owner,
    id: optionalString(input.id, "id") ?? crypto.randomUUID(),
    name,
    slug: optionalString(input.slug, "slug") ?? toSlug(name),
    description: optionalString(input.description, "description") ?? "",
    origin: input.origin === undefined ? "studio" : oneOf(input.origin, skillOrigins, "origin"),
    status: input.status === undefined ? "draft" : oneOf(input.status, skillStatuses, "status"),
    currentVersion: optionalString(input.currentVersion ?? input.version, "currentVersion") ?? "0.1.0",
    instructionsRef: requireString(input.instructionsRef, "instructionsRef"),
    configRef: optionalString(input.configRef, "configRef"),
    tags: optionalStringArray(input.tags, "tags"),
    metadata: optionalObject(input.metadata, "metadata"),
    activationRules: optionalObject(input.activationRules, "activationRules"),
    requiredTools: optionalStringArray(input.requiredTools, "requiredTools"),
    requiredPermissions: optionalStringArray(input.requiredPermissions, "requiredPermissions"),
    resources: input.resources === undefined ? [] : ensureArray(input.resources, "resources"),
    mcpServerIds: optionalStringArray(input.mcpServerIds, "mcpServerIds"),
    createdAt: "",
    updatedAt: "",
  };
}

export function normalizeSkillPatch(current: SkillRecord, body: unknown): SkillRecord {
  const input = readObject(body);
  const name = optionalString(input.name, "name") ?? current.name;

  return {
    ...current,
    name,
    slug: optionalString(input.slug, "slug") ?? (input.name ? toSlug(name) : current.slug),
    description: optionalString(input.description, "description") ?? current.description,
    origin: input.origin === undefined ? current.origin : oneOf(input.origin, skillOrigins, "origin"),
    status: input.status === undefined ? current.status : oneOf(input.status, skillStatuses, "status"),
    currentVersion: optionalString(input.currentVersion ?? input.version, "currentVersion") ?? current.currentVersion,
    instructionsRef: optionalString(input.instructionsRef, "instructionsRef") ?? current.instructionsRef,
    configRef: optionalString(input.configRef, "configRef") ?? current.configRef,
    tags: input.tags === undefined ? current.tags : optionalStringArray(input.tags, "tags"),
    metadata: input.metadata === undefined ? current.metadata : optionalObject(input.metadata, "metadata"),
    activationRules: input.activationRules === undefined ? current.activationRules : optionalObject(input.activationRules, "activationRules"),
    requiredTools: input.requiredTools === undefined ? current.requiredTools : optionalStringArray(input.requiredTools, "requiredTools"),
    requiredPermissions:
      input.requiredPermissions === undefined
        ? current.requiredPermissions
        : optionalStringArray(input.requiredPermissions, "requiredPermissions"),
    resources: input.resources === undefined ? current.resources : ensureArray(input.resources, "resources"),
    mcpServerIds: input.mcpServerIds === undefined ? current.mcpServerIds : optionalStringArray(input.mcpServerIds, "mcpServerIds"),
  };
}

export function parseSkillSearch(url: URL, userId: string): SkillSearch {
  const limit = Number(url.searchParams.get("limit") ?? "50");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw badRequest("limit must be between 1 and 100.");
  const status = url.searchParams.get("status");
  const origin = url.searchParams.get("origin");
  const ownerType = url.searchParams.get("ownerType");
  return {
    userId,
    query: url.searchParams.get("q") ?? undefined,
    status: status ? oneOf(status, skillStatuses, "status") : undefined,
    origin: origin ? oneOf(origin, skillOrigins, "origin") : undefined,
    ownerType: ownerType ? oneOf(ownerType, ["system", "user"] as const, "ownerType") : undefined,
    tag: url.searchParams.get("tag") ?? undefined,
    limit,
  };
}

export function skillChangeNote(body: unknown): string | undefined {
  return optionalString(readObject(body).changeNote, "changeNote");
}

function readObject(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw badRequest("Request body must be an object.");
  return value as Record<string, unknown>;
}

function ensureArray(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array.`);
  return value;
}

function toSlug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
