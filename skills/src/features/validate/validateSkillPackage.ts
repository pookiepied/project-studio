import { validateManifest } from "./validateManifest";
import { parseSkillFrontmatter } from "./parseSkillFrontmatter";
import type { SkillManifest, SkillValidationResult } from "../types";

/**
 * Validate a complete skill package: a required skill.json manifest, plus an
 * optional SKILL.md body. When a skill.json is missing (third-party imported
 * skills), callers may instead pass a SKILL.md alone and we parse metadata
 * from its frontmatter.
 *
 * Security: this never executes anything — it only parses and inspects.
 */
export function validateSkillPackage(input: {
  manifest?: unknown;
  skillMd?: string;
}): SkillValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  let manifest: SkillManifest | undefined;

  if (input.manifest !== undefined) {
    const r = validateManifest(input.manifest);
    errors.push(...r.errors);
    warnings.push(...r.warnings);
    if (r.manifest) manifest = r.manifest;
  } else if (input.skillMd) {
    // Third-party: no skill.json — derive metadata from frontmatter.
    const { frontmatter } = parseSkillFrontmatter(input.skillMd);
    if (!frontmatter.name && !frontmatter.description) {
      warnings.push("SKILL.md has no frontmatter and no skill.json — using the first heading as name");
    }
    const headingMatch = input.skillMd.match(/^#\s+(.+)$/m);
    manifest = {
      key: String(frontmatter.name ?? headingMatch?.[1] ?? "unknown").trim().toLowerCase().replace(/\s+/g, "_"),
      name: String(frontmatter.name ?? headingMatch?.[1] ?? "Unnamed Skill"),
      description: String(frontmatter.description ?? ""),
      category: frontmatter.category ? String(frontmatter.category) : undefined,
      version: frontmatter.version ? String(frontmatter.version) : undefined,
      scope: frontmatter.scope ? String(frontmatter.scope) === "local" ? "local" : "system" : undefined,
      allowed_runtime: (() => {
        const v = frontmatter.allowed_runtime ? String(frontmatter.allowed_runtime) : undefined;
        return v && ["cloud", "local", "both"].includes(v) ? (v as SkillManifest["allowed_runtime"]) : undefined;
      })(),
    };
    if (!manifest.key || manifest.key === "unknown") errors.push("Could not derive a skill key from frontmatter or heading");
  } else {
    errors.push("Nothing to validate — provide manifest and/or skillMd");
  }

  // Cross-check: frontmatter name (if present) should match manifest key.
  if (manifest && input.skillMd) {
    const { frontmatter } = parseSkillFrontmatter(input.skillMd);
    if (frontmatter.name && manifest.key && String(frontmatter.name).toLowerCase().replace(/\s+/g, "_") !== manifest.key) {
      warnings.push(`SKILL.md frontmatter name "${frontmatter.name}" does not match skill.json key "${manifest.key}"`);
    }
  }

  return { valid: errors.length === 0, errors, warnings, manifest };
}
