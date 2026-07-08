/**
 * Bundled (system/cloud) skills are real skill packages compiled into the
 * Worker at build time. Their SKILL.md files are imported as raw text via the
 * wrangler `[[rules]]` Text module rule; their skill.json is imported natively.
 *
 * To add a new bundled skill: drop a folder under src/bundled/<key>/ with
 * SKILL.md + skill.json, then add an import + entry below. Everything else
 * (catalog, index, read, search, MCP tools) picks it up automatically.
 */
import type { SkillManifest, SkillSummary } from "../types";

// ── manifests ────────────────────────────────────────────────────────────────
import productSelfManifest from "../../bundled/product-self-knowledge/skill.json";

// ── content (.md → string via wrangler Text rule) ────────────────────────────
import productSelfMd from "../../bundled/product-self-knowledge/SKILL.md";

export interface BundledSkill {
  manifest: SkillManifest;
  content: string;
}

const BUNDLED: BundledSkill[] = [
  { manifest: productSelfManifest as SkillManifest, content: productSelfMd },
];

/** All bundled skill packages (manifest + inlined content). */
export function getBundledSkills(): BundledSkill[] {
  return BUNDLED;
}

/** Full SKILL.md content for a bundled skill by key, or null if not found. */
export function getBundledContent(key: string): string | null {
  return BUNDLED.find((s) => s.manifest.key === key)?.content ?? null;
}

/** Manifest for a bundled skill by key, or null. */
export function getBundledManifest(key: string): SkillManifest | null {
  return BUNDLED.find((s) => s.manifest.key === key)?.manifest ?? null;
}

/** Bundled skills normalized into catalog summaries. */
export function getBundledSummaries(): SkillSummary[] {
  return BUNDLED.map((s) => toSummary(s.manifest));
}

export function toSummary(m: SkillManifest): SkillSummary {
  return {
    key: m.key,
    name: m.name,
    description: m.description,
    category: m.category ?? "General",
    version: m.version ?? "0.0.0",
    scope: m.scope ?? "system",
    allowedRuntime: m.allowed_runtime ?? "cloud",
    sourceType: "bundled",
    bundled: true,
    contentReadable: true,
  };
}
