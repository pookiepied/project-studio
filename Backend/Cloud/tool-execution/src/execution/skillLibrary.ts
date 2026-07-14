import type { ToolExecutionRequest, ToolRoute } from "../contracts";
import { invalidRequest, notImplemented, upstreamError } from "../errors";
import type { Env } from "../system/env";

type SkillRoute = Extract<ToolRoute, { kind: "skill-library" }>;

const bundledSkillContent: Record<string, string> = {
  "product-self-knowledge": `---
name: Product Self-Knowledge
description: Use when an agent needs a concise, current understanding of Studio's product identity and cloud/local architecture.
---

# Product Self-Knowledge

Studio is an AI workspace built by pookiepied for cloud-local agent workflows, software work, research, and tool-assisted execution.
The cloud system is being split into focused Workers instead of one overloaded chat worker.
Gateway owns model-provider routing; runtimes own agent loops; Context assembles relevant resources; Data owns user content and artifacts.
The Cloud Library Registry stores searchable registrations for system and future user-scoped skills, MCP servers, and agents.
The Agent, Skill, and MCP Libraries store full definitions for those resource types while the registry keeps metadata and references.
Memory and native tools are first-party platform services, not ordinary discoverable MCP library entries.
Cloud resources are system-managed first, but registry and library schemas are designed for future user-scoped resources with strict isolation.
Do not claim a Studio feature is live unless it is verified in the current codebase or current runtime.
`,
};

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
      const content = bundledSkillContent[skill.id];
      if (!content) throw notImplemented("Only bundled system SKILL.md reads are available in the first Tool Execution Worker pass.", { skillId: skill.id });
      return { skill, content, frontmatter: { name: skill.name, description: skill.description }, resourceRefs: skill.resources };
    }
    case "skill_resolve": {
      const skill = requireSkill(skills, request);
      return { skill, loadOrder: [skill.instructionsRef, ...skill.resources], warnings: [] };
    }
    case "skill_read_resource":
      throw notImplemented("skill_read_resource requires Skill Library resource endpoints before it can read supporting files.");
  }
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
