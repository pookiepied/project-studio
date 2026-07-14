import type { RegistrySkillRecord, SkillContext } from "../contracts";
import type { Env } from "../system/env";

/**
 * Skill layer: relevant skills with summaries and activation conditions.
 * Full instructions load progressively when a skill is activated.
 */
export async function buildSkillContext(
  env: Env,
  userId: string,
  task: string,
): Promise<SkillContext[]> {
  const response = await env.REGISTRY.fetch("http://registry/skills", { headers: { "x-user-id": userId } });
  if (!response.ok) throw new Error(`Registry skill lookup failed (${response.status}).`);
  const { items } = await response.json<{ items: RegistrySkillRecord[] }>();
  const tokens = new Set(task.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 2));
  return items.filter((item) => item.status === "active").filter((item) => {
    const haystack = `${item.name} ${item.description} ${JSON.stringify(item.activationRules)}`.toLowerCase();
    return tokens.size === 0 || [...tokens].some((token) => haystack.includes(token));
  }).map((item) => ({
    ref: { id: item.id, kind: "skill", name: item.name, scope: item.ownerType },
    summary: item.description,
    activationHint: activationHint(item),
  }));
}

function activationHint(skill: RegistrySkillRecord): string | undefined {
  const value = skill.activationRules.hint ?? skill.activationRules.when;
  return typeof value === "string" ? value : undefined;
}
