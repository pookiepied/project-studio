import type { SkillManifest, SkillValidationResult } from "../types";

const RUNTIMES = new Set(["cloud", "local", "both"]);
const SCOPES = new Set(["system", "local"]);

/**
 * Validate a parsed skill.json manifest. Returns errors (blocking) and warnings
 * (non-blocking). A valid manifest has at least key/name/description and uses
 * the allowed enum values for scope/allowed_runtime.
 */
export function validateManifest(manifest: unknown): SkillValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!manifest || typeof manifest !== "object") {
    return { valid: false, errors: ["Manifest is not a JSON object"], warnings };
  }
  const m = manifest as Record<string, unknown>;

  const strField = (k: string) =>
    typeof m[k] === "string" ? (m[k] as string).trim() : "";

  const key = strField("key");
  if (!key) errors.push("Missing required field: key");
  else if (!/^[a-z0-9_-]+$/i.test(key)) warnings.push(`Key "${key}" contains characters outside [a-z0-9_-]`);

  if (!strField("name")) errors.push("Missing required field: name");
  if (!strField("description")) errors.push("Missing required field: description");

  const rt = m["allowed_runtime"];
  if (rt !== undefined && !RUNTIMES.has(String(rt))) {
    errors.push(`allowed_runtime must be one of cloud|local|both (got "${rt}")`);
  }
  const scope = m["scope"];
  if (scope !== undefined && !SCOPES.has(String(scope))) {
    errors.push(`scope must be one of system|local (got "${scope}")`);
  }

  if (!Array.isArray(m["when_to_use"]) && m["when_to_use"] !== undefined) {
    warnings.push("when_to_use should be an array of strings");
  }

  return { valid: errors.length === 0, errors, warnings, manifest: m as unknown as SkillManifest };
}
