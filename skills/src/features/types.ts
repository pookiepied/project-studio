/**
 * Shared skill domain types used across every feature module.
 *
 * These mirror the `skill.json` manifest shape from the Agent Skills standard
 * and the D1 `skill_registrations` row shape.
 */

export type SkillRuntime = "cloud" | "local" | "both";
export type SkillScope = "system" | "local";
export type SkillSourceType = "bundled" | "local_path" | "github";

/**
 * The manifest written as `skill.json` inside a skill package.
 * Required for Studio-managed skills. For imported third-party skills where
 * `skill.json` is missing, metadata is parsed from SKILL.md frontmatter.
 */
export interface SkillManifest {
  key: string;
  name: string;
  description: string;
  category?: string;
  version?: string;
  scope?: SkillScope;
  allowed_runtime?: SkillRuntime;
  entrypoint?: string;
  when_to_use?: string[];
  required_tools?: string[];
  permissions?: string[];
}

export interface SkillFrontmatter {
  name?: string;
  description?: string;
  [k: string]: unknown;
}

/**
 * A single skill entry in a catalog response — normalized across bundled
 * and locally-registered skills so the catalog/index/list/build paths look
 * identical regardless of source.
 */
export interface SkillSummary {
  key: string;
  name: string;
  description: string;
  category: string;
  version: string;
  scope: SkillScope;
  allowedRuntime: SkillRuntime;
  sourceType: SkillSourceType;
  /** Present when the skill content is bundled (readable from cloud). */
  bundled?: boolean;
  /** Local FS path for local skills; undefined for bundled. */
  localPath?: string | null;
  /** Source URL for github-local skills. */
  sourceUrl?: string | null;
  /** Device id for device-scoped local registrations. */
  deviceId?: string | null;
  /**
   * Whether the full SKILL.md content is readable from this runtime.
   * Bundled skills: always true (content is compiled in).
   * Local skills: false for cloud callers (content lives on the user's
   *   machine); the desktop/local runtime exposes skill_read_local for that.
   */
  contentReadable: boolean;
  /** When a duplicate key is shadowed by a higher-precedence skill. */
  shadowedBy?: string;
}

/** Query parameters shaping a catalog/index/list/search response. */
export interface SkillQuery {
  userId?: string;
  deviceId?: string;
  /**
   * "cloud" = bundled cloud/system skills only.
   * "local" = bundled (scope=system/both) + this user's local registrations.
   */
  runtime?: "cloud" | "local";
}

/** Result of a manifest / package validation. */
export interface SkillValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  manifest?: SkillManifest;
}

/** A safe install plan for a GitHub/local source (never executes scripts). */
export interface SkillInstallPlan {
  source: string;
  sourceType: SkillSourceType;
  targetPath: string;
  steps: { action: string; detail: string }[];
  notes: string[];
  /** Never resolved in the cloud — local runtime must perform the install. */
  requiresLocalRuntime: boolean;
}
