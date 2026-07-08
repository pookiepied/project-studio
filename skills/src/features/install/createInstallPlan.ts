import { normalizeGithubSource } from "./normalizeGithubSource";
import type { SkillInstallPlan, SkillSourceType } from "../types";

const SAFE_KEY_RE = /^[a-z0-9_-]+$/i;

/**
 * Produce a safe, human-reviewable install plan for a GitHub URL or local path
 * descriptor. The cloud worker NEVER performs the install — local skill content
 * stays on the user's machine. It returns the plan and the local runtime /
 * studio-harness executes it under the user's supervision.
 *
 * Security rules enforced by the plan (documented for the local executor):
 *   - clone/download only; never execute install scripts from imported skills
 *   - reject path traversal / unsafe target keys
 *   - never overwrite an existing skill folder (prompt the user instead)
 *   - keep content local; only register metadata here
 */
export function createInstallPlan(source: string): SkillInstallPlan {
  if (!source || !source.trim()) {
    return {
      source: "",
      sourceType: "local_path",
      targetPath: "",
      steps: [],
      notes: ["No source provided."],
      requiresLocalRuntime: true,
    };
  }

  const gh = normalizeGithubSource(source);

  if (gh) {
    const derivedKey = gh.subPath
      ? gh.subPath.split("/").pop() ?? gh.repo
      : gh.repo;
    const safeKey = SAFE_KEY_RE.test(derivedKey) ? derivedKey : "imported-skill";
    const targetSub = gh.subPath ? `${gh.repo}/${derivedKey}` : gh.repo;
    const targetPath = `$HOME/.studio/skills/${safeKey}`;

    return {
      source,
      sourceType: "github",
      targetPath,
      steps: [
        { action: "resolve-home", detail: "Resolve $HOME to the user's home directory." },
        { action: "clone", detail: `git clone --depth 1 ${gh.ref ? `--branch ${gh.ref} ` : ""}${gh.cloneUrl} into a temp scratch dir${gh.subPath ? ` then narrow to ${gh.subPath}` : ""}.` },
        { action: "locate-skills", detail: `Find skill folders (containing SKILL.md). If multiple, ask the user which to install or return a structured listing${gh.subPath ? "" : " — the repo root or any subfolder may be a skill"}.` },
        { action: "validate", detail: `Validate each candidate: parse skill.json or SKILL.md frontmatter; reject if no usable key/name/description.` },
        { action: "reject-unsafe-paths", detail: `Ensure the resolved target key matches [a-z0-9_-]; derived key is "${safeKey}". Reject path traversal (.., absolute, drive roots).` },
        { action: "stage", detail: `Copy the skill folder into ${targetPath}. Do NOT overwrite if it exists — prompt the user first (prefer symlinks for compat links only with approval).` },
        { action: "register", detail: `Register metadata with the studio-skills worker via skill_register_local (userId, key, name, description, source_type=github, source_url=${gh.cloneUrl}, local_path=${targetPath}). Do NOT upload SKILL.md content.` },
        { action: "cleanup", detail: "Delete the temp scratch clone. Keep the skill content under $HOME/.studio/skills only." },
      ],
      notes: [
        "Do not run any install scripts (postinstall, setup.sh, etc.) shipped with the repo.",
        `Reference repo: https://github.com/${gh.owner}/${gh.repo}${gh.ref ? ` @ ${gh.ref}` : ""}.`,
        `Narrowed sub-path: ${gh.subPath ?? "(repo root)"}.`,
        `Cloned from: ${targetSub}.`,
      ],
      requiresLocalRuntime: true,
    };
  }

  // Local path source — e.g. an existing folder on the user's machine.
  const derivedKey = source.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? "imported-skill";
  const safeKey = SAFE_KEY_RE.test(derivedKey) ? derivedKey : "imported-skill";
  const targetPath = `$HOME/.studio/skills/${safeKey}`;

  return {
    source,
    sourceType: "local_path",
    targetPath,
    steps: [
      { action: "validate-source", detail: `Confirm "${source}" exists and contains SKILL.md (or skill.json).` },
      { action: "validate", detail: `Parse skill.json or SKILL.md frontmatter; reject if no usable key/name/description.` },
      { action: "reject-unsafe-paths", detail: `Resolved key "${safeKey}" must match [a-z0-9_-]; reject path traversal.` },
      { action: "stage", detail: `Copy or symlink the folder into ${targetPath}. Do NOT overwrite an existing folder — prompt the user first.` },
      { action: "register", detail: `Register metadata via skill_register_local (source_type=local_path, local_path=${targetPath}, source_url=null). Do NOT upload content.` },
    ],
    notes: [
      "Do not execute any scripts.",
      "Do not move or modify the original folder — copy or symlink only.",
      `Derived key: ${safeKey}.`,
    ],
    requiresLocalRuntime: true,
  } satisfies SkillInstallPlan & { sourceType: SkillSourceType };
}
