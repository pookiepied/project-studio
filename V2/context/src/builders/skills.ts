import type { SkillContext } from "@studio/v2-contracts";
import type { Env } from "../system/env";

/**
 * Skill layer (§19.4): relevant skills with summaries and activation
 * conditions. Full instructions load progressively — only when a skill is
 * activated, never for every skill in every request.
 */
export async function buildSkillContext(
  _env: Env,
  _userId: string,
  _task: string,
): Promise<SkillContext[]> {
  throw new Error("not_implemented");
}
