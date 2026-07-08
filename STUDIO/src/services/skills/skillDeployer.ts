import { invoke } from "@tauri-apps/api/core";
import { logger } from "../logging/logger";
import { tokenManager } from "../../utils/tokenManager";
import { apiManager } from "../network/apiManager";

/**
 * Skill Deployer
 * ==============
 * On first app launch (or when new bundled skills are added), deploys the
 * built-in local management skills from the frontend bundle to
 * $HOME/.studio/skills/ and registers them via the Skills API.
 *
 * Skills are bundled at build time via Vite's import.meta.glob('?raw') so
 * their content (SKILL.md + skill.json) ships inside the app binary — no
 * network fetch needed for the initial deployment.
 */

// ── Bundled skill files (imported as raw strings at build time) ──────────────
const SKILL_FILES = import.meta.glob("../../skills/**/*.{md,json}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

interface BundledSkill {
  key: string;
  skillMd: string;
  manifestJson: string;
}

function parseBundledSkills(): BundledSkill[] {
  const grouped: Map<string, BundledSkill> = new Map();

  for (const [filePath, content] of Object.entries(SKILL_FILES)) {
    const normalized = filePath.replace(/\\/g, "/");
    const match = normalized.match(/\/skills\/([^/]+)\/(SKILL\.md|skill\.json)$/);
    if (!match) continue;

    const [, key, filename] = match;
    if (!grouped.has(key)) {
      grouped.set(key, { key, skillMd: "", manifestJson: "" });
    }
    const entry = grouped.get(key)!;
    if (filename === "SKILL.md") entry.skillMd = content;
    else if (filename === "skill.json") entry.manifestJson = content;
  }

  return Array.from(grouped.values()).filter((s) => s.skillMd.length > 0);
}

const DEPLOYED_FLAG_KEY = "studio-skills-deployed-v2";

interface DeploymentState {
  version: 2;
  skills: Record<string, {
    contentHash?: string;
    registeredHash?: string;
    deployedAt?: string;
    registeredAt?: string;
  }>;
}

function loadDeploymentState(): DeploymentState {
  try {
    const raw = localStorage.getItem(DEPLOYED_FLAG_KEY);
    if (!raw) return { version: 2, skills: {} };
    const parsed = JSON.parse(raw) as Partial<DeploymentState>;
    return {
      version: 2,
      skills: parsed.skills && typeof parsed.skills === "object" ? parsed.skills : {},
    };
  } catch {
    return { version: 2, skills: {} };
  }
}

function saveDeploymentState(state: DeploymentState): void {
  localStorage.setItem(DEPLOYED_FLAG_KEY, JSON.stringify(state));
}

function joinPath(homeDir: string, ...parts: string[]): string {
  const sep = homeDir.includes("\\") && !homeDir.includes("/") ? "\\" : "/";
  const normalized = parts.map((p) => p.replace(/\\/g, "/").replace(/^\/+|\/+$/g, ""));
  return [homeDir.replace(/[\\/]+$/, ""), ...normalized].join(sep);
}

async function computeHash(text: string): Promise<string> {
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const data = new TextEncoder().encode(text);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hashBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16);
}

function parseManifest(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json);
  } catch {
    return {};
  }
}

async function writeTextFile(path: string, content: string): Promise<void> {
  await invoke("write_text_file", { path, content });
}

/**
 * Deploy bundled local skills to $HOME/.studio/skills/ on first launch.
 * Safe to call on every startup — skips deployment if already done.
 *
 * Uses the Tauri filesystem to write files, then registers each skill via
 * the STUDIO API (POST /v1/skills/local → skills worker → D1).
 */
export async function deployBundledLocalSkills(): Promise<void> {
  const skills = parseBundledSkills();
  if (skills.length === 0) {
    logger.warn("SkillDeployer", "No bundled skills found to deploy");
    return;
  }

  let homeDir: string;
  try {
    homeDir = await invoke<string>("get_home_dir");
  } catch (e) {
    logger.error("SkillDeployer", "Cannot get home dir — skipping skill deployment", e);
    return;
  }

  const skillsRoot = joinPath(homeDir, ".studio", "skills");
  logger.info("SkillDeployer", `Deploying ${skills.length} bundled skills to ${skillsRoot}`);

  const accessToken = await tokenManager.getAccessToken();
  if (!accessToken) {
    logger.warn("SkillDeployer", "No auth token — will deploy files but skip registration. Registration will retry on next authed launch.");
  }

  let deployedCount = 0;
  let skippedCount = 0;
  let registeredCount = 0;
  let failedCount = 0;
  const state = loadDeploymentState();
  const apiConfig = accessToken ? await apiManager.getConfig().catch(() => null) : null;
  const baseUrl = apiConfig?.baseUrl?.replace(/\/$/, "");

  for (const skill of skills) {
    try {
      const skillDir = joinPath(skillsRoot, skill.key);
      const manifest = parseManifest(skill.manifestJson);
      const contentHash = await computeHash(skill.skillMd);
      const previous = state.skills[skill.key] ?? {};
      const now = new Date().toISOString();

      if (previous.contentHash !== contentHash) {
        // Write SKILL.md
        await writeTextFile(joinPath(skillDir, "SKILL.md"), skill.skillMd);

        // Write skill.json when bundled metadata exists. STUDIO bundled skills
        // normally include this, but SKILL.md-only packages are still valid.
        if (skill.manifestJson.trim()) {
          await writeTextFile(joinPath(skillDir, "skill.json"), skill.manifestJson);
        }

        deployedCount++;
        state.skills[skill.key] = {
          ...previous,
          contentHash,
          deployedAt: now,
        };
        saveDeploymentState(state);
        logger.info("SkillDeployer", `Deployed skill files: ${skill.key}`);
      } else {
        skippedCount++;
      }

      // Register via API (if authenticated)
      if (accessToken && baseUrl && state.skills[skill.key]?.registeredHash !== contentHash) {
        const res = await fetch(`${baseUrl}/v1/skills/local`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${accessToken}`,
          },
          body: JSON.stringify({
            key: manifest.key ?? skill.key,
            name: manifest.name ?? skill.key,
            description: manifest.description ?? "",
            category: manifest.category ?? "Skill Management",
            version: manifest.version ?? "1.0.0",
            allowed_runtime: manifest.allowed_runtime ?? "local",
            source_type: "local_path",
            local_path: skillDir,
            manifest_json: skill.manifestJson,
            content_hash: contentHash,
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => "");
          throw new Error(`Registration failed (${res.status}): ${body || res.statusText}`);
        }

        registeredCount++;
        state.skills[skill.key] = {
          ...state.skills[skill.key],
          registeredHash: contentHash,
          registeredAt: now,
        };
        saveDeploymentState(state);
        logger.info("SkillDeployer", `Registered skill: ${skill.key}`);
      }
    } catch (e) {
      failedCount++;
      logger.error("SkillDeployer", `Failed to deploy skill: ${skill.key}`, e);
    }
  }

  logger.info(
    "SkillDeployer",
    `Deployment complete: ${deployedCount} deployed, ${skippedCount} unchanged, ${registeredCount} registered, ${failedCount} failed`
  );
}
