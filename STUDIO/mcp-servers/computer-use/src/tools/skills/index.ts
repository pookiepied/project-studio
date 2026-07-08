import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { wrapTool } from "../tool-contract.js";

const SKILL_KEY_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

async function readLocalSkillImpl(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const skill = typeof args.skill === "string" ? args.skill.trim() : "";
  if (!SKILL_KEY_RE.test(skill)) {
    return {
      error:
        "skill_read_local: invalid skill key. Use lowercase letters, numbers, hyphens, or underscores, max 64 characters.",
    };
  }

  const skillPath = path.join(os.homedir(), ".studio", "skills", skill, "SKILL.md");
  const content = await fs.readFile(skillPath, "utf8");

  return {
    skill,
    path: skillPath,
    content,
    contentReadable: true,
  };
}

export const readLocalSkill = wrapTool("skill_read_local", readLocalSkillImpl);
