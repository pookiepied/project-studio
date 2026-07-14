import type { RegistrySkillRecord, SkillContext } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * Skill layer (§19.4): relevant skills with summaries and activation
 * conditions. Full instructions load progressively — only when a skill is
 * activated, never for every skill in every request.
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
  return items.filter((item) => item.enabled && item.available).filter((item) => {
    const haystack = `${item.ref.name} ${item.description} ${JSON.stringify(item.activationRules)}`.toLowerCase();
    return tokens.size === 0 || [...tokens].some((token) => haystack.includes(token));
  }).map((item) => ({ ref: item.ref, summary: item.description, activationHint: activationHint(item) }));
}

function activationHint(skill: RegistrySkillRecord): string | undefined {
  const value = skill.activationRules.hint ?? skill.activationRules.when;
  return typeof value === "string" ? value : undefined;
}
