import type { SkillFrontmatter } from "../types";

/**
 * Parse the YAML frontmatter block from a SKILL.md file (the common Agent
 * Skills `---\n...\n---` prologue). Supports only the flat `key: value` subset
 * the standard requires — no nested mappings, no flow collections. Values may
 * be bare strings or single/double-quoted.
 */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseSkillFrontmatter(md: string): { frontmatter: SkillFrontmatter; body: string } {
  const m = FRONTMATTER_RE.exec(md);
  if (!m) return { frontmatter: {}, body: md };

  const fm: SkillFrontmatter = {};
  const lines = m[1].split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let val = trimmed.slice(idx + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    fm[key] = val;
  }
  return { frontmatter: fm, body: md.slice(m[0].length) };
}
