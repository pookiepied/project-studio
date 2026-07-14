import { getBundledContent } from "../bundled/bundledCatalog";
import { listRegistrations, rowToSummary } from "../../storage/queries";
import { resolveSkillPrecedence } from "../catalog/resolveSkillPrecedence";
import type { Env } from "../../env";
import type { SkillQuery } from "../types";

/**
 * Read a skill by key.
 *
 * Bundled/system: returns the full SKILL.md content (compiled into the Worker).
 *
 * Local-registered: returns metadata + local path and explicitly marks
 * `contentReadable: false`. The cloud worker has no filesystem — it must never
 * pretend to read local-only content. When a local/desktop runtime is online,
 * the model should read `${localPath}/SKILL.md` through Computer Use
 * `skill_read_local` or Studio Harness `read_file`. Otherwise it should ask
 * the user to enable the desktop runtime.
 * This mirrors the doc's "do not fake local-readability"
 * acceptance criterion.
 */
export interface SkillReadResult {
  found: boolean;
  skill: string;
  name: string;
  category: string;
  description: string;
  scope: string;
  allowedRuntime: string;
  sourceType: string;
  bundled: boolean;
  /** Present and non-null only for bundled skills. */
  content: string | null;
  /** Local filesystem path (local skills only). */
  localPath?: string | null;
  /** Whether the calling runtime can read the full SKILL.md content. */
  contentReadable: boolean;
  shadowedBy?: string;
  note?: string;
}

export async function readSkill(
  env: Env,
  key: string,
  query: SkillQuery = {},
): Promise<SkillReadResult | null> {
  const bundledContent = getBundledContent(key);
  if (bundledContent !== null) {
    const { getBundledManifest } = await import("../bundled/bundledCatalog");
    const m = getBundledManifest(key);
    if (!m) return null;
    return {
      found: true,
      skill: m.key,
      name: m.name,
      category: m.category ?? "General",
      description: m.description,
      scope: m.scope ?? "system",
      allowedRuntime: m.allowed_runtime ?? "cloud",
      sourceType: "bundled",
      bundled: true,
      content: bundledContent,
      localPath: null,
      contentReadable: true,
    };
  }

  // Not bundled — look in the user's local registrations.
  if (!query.userId) return null;
  const rows = await listRegistrations(env, query.userId, {
    deviceId: query.deviceId,
    includeDisabled: false,
  });
  const local = rows.filter((r) => r.key === key).map(rowToSummary);
  if (local.length === 0) return null;

  // Local precedence among same-key siblings: pick the winner.
  const merged = resolveSkillPrecedence([], local);
  const winner = merged.find((s) => !s.shadowedBy) ?? merged[0];

  return {
    found: true,
    skill: winner.key,
    name: winner.name,
    category: winner.category,
    description: winner.description,
    scope: winner.scope,
    allowedRuntime: winner.allowedRuntime,
    sourceType: winner.sourceType,
    bundled: false,
    content: null,
    localPath: winner.localPath ?? null,
    contentReadable: false,
    shadowedBy: winner.shadowedBy,
    note:
      "Local skill content lives on the user's machine and is not uploaded. " +
      "If Computer Use is connected, call mcp_computer_use__skill_read_local. " +
      "If Studio Harness is connected, read localPath + '/SKILL.md' with " +
      "mcp_studio_harness__read_file. If no local " +
      "runtime is paired, ask the user to enable STUDIO desktop local tools.",
  };
}
