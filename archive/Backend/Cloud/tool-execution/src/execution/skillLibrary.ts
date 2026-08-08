import type { ToolExecutionRequest, ToolRoute } from "../contracts";
import { invalidRequest, notImplemented, upstreamError } from "../errors";
import type { Env } from "../system/env";

type SkillRoute = Extract<ToolRoute, { kind: "skill-library" }>;

export async function dispatchSkillLibrary(env: Env, request: ToolExecutionRequest, route: SkillRoute): Promise<unknown> {
  const skills = await listSystemSkills(env);
  switch (route.action) {
    case "skill_list":
      return { items: filterSkills(skills, request) };
    case "skill_search":
      return { items: searchSkills(skills, request) };
    case "skill_get": {
      const skill = requireSkill(skills, request);
      return { skill, resources: skill.resources, permissions: skill.requiredPermissions };
    }
    case "skill_read": {
      const skill = requireSkill(skills, request);
      return readSkillInstructions(env, skill);
    }
    case "skill_resolve": {
      const skill = requireSkill(skills, request);
      return { skill, loadOrder: [skill.instructionsRef, ...skill.resources], warnings: [] };
    }
    case "skill_read_resource":
      throw notImplemented("skill_read_resource requires Skill Library resource endpoints before it can read supporting files.");
  }
}

async function readSkillInstructions(env: Env, skill: SkillDefinition): Promise<unknown> {
  const response = await env.SKILL_LIBRARY.fetch(`https://skill-library/skills/system/${encodeURIComponent(skill.id)}/read`);
  const body = await readJson(response);
  if (!response.ok) throw upstreamError("Skill Library read failed.", body, response.status >= 500);
  return body;
}

async function listSystemSkills(env: Env): Promise<SkillDefinition[]> {
  const response = await env.SKILL_LIBRARY.fetch("https://skill-library/skills/system");
  const body = await readJson(response);
  if (!response.ok) throw upstreamError("Skill Library lookup failed.", body, response.status >= 500);
  const items = typeof body === "object" && body !== null && Array.isArray((body as { items?: unknown }).items)
    ? (body as { items: SkillDefinition[] }).items
    : [];
  return items;
}

function filterSkills(skills: SkillDefinition[], request: ToolExecutionRequest): SkillDefinition[] {
  const status = optionalString(request, "status");
  const tag = optionalString(request, "tag");
  const limit = numberArg(request, "limit", 50);
  return skills.filter((skill) => (!status || skill.status === status) && (!tag || skill.metadata[tag] === true || skill.resources.includes(tag))).slice(0, limit);
}

function searchSkills(skills: SkillDefinition[], request: ToolExecutionRequest): SkillDefinition[] {
  const query = stringArg(request, "query").toLowerCase();
  const limit = numberArg(request, "limit", 5);
  return skills.filter((skill) => `${skill.name} ${skill.description} ${skill.activation.when} ${skill.activation.hints.join(" ")}`.toLowerCase().includes(query)).slice(0, limit);
}

function requireSkill(skills: SkillDefinition[], request: ToolExecutionRequest): SkillDefinition {
  const skillId = stringArg(request, "skillId");
  const skill = skills.find((item) => item.id === skillId || item.slug === skillId);
  if (!skill) throw invalidRequest(`Skill ${skillId} was not found or is not visible to this user.`);
  return skill;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function stringArg(request: ToolExecutionRequest, name: string): string {
  const value = request.arguments[name];
  if (typeof value !== "string" || value.trim() === "") throw invalidRequest(`${name} is required for ${request.toolName}.`);
  return value;
}

function optionalString(request: ToolExecutionRequest, name: string): string | undefined {
  const value = request.arguments[name];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw invalidRequest(`${name} must be a string.`);
  return value;
}

function numberArg(request: ToolExecutionRequest, name: string, fallback: number): number {
  const value = request.arguments[name];
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) throw invalidRequest(`${name} must be a positive integer.`);
  return value;
}

interface SkillDefinition {
  id: string;
  name: string;
  slug: string;
  description: string;
  version: string;
  status: string;
  owner: { type: "system" | "user"; userId?: string };
  instructionsRef: string;
  activation: { when: string; hints: string[] };
  requiredTools: string[];
  requiredPermissions: string[];
  resources: string[];
  mcpServerIds: string[];
  metadata: Record<string, unknown>;
}
