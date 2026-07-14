import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Env } from "../env";
import { listSkills } from "../features/catalog/listSkills";
import { buildSkillIndex } from "../features/catalog/buildSkillIndex";
import { readSkill } from "../features/read/readSkill";
import { searchSkills } from "../features/search/searchSkills";
import { validateSkillPackage } from "../features/validate/validateSkillPackage";
import {
  registerLocalSkill,
  unregisterLocalSkill,
  heartbeatLocalSkill,
} from "../features/localRegistry";
import { createInstallPlan } from "../features/install/createInstallPlan";

const text = (data: unknown) => ({ content: [{ type: "text" as const, text: JSON.stringify(data) }] });

/**
 * STUDIO Skills MCP agent, served at /mcp.
 *
 * These tool schemas are ALSO advertised by the studio-mcp hub's native-service
 * catalog, so both the main chat agent and research sub-agents reach the same
 * implementation through one path. The hub proxies `tools/call` here.
 *
 * Tool list: skill_read, skill_list, skill_search, skill_validate,
 *            skill_register_local, skill_unregister_local, skill_install_plan.
 */
export class StudioSkillsAgent extends McpAgent<Env> {
  server = new McpServer({
    name: "studio-skills",
    version: "1.0.0",
  });

  async init(): Promise<void> {
    const runtimeSchema = z.enum(["cloud", "local"]).optional().describe("cloud = bundled cloud/system skills only; local = include the user's registered local skills. Defaults to cloud.");

    // ── skill_read ──────────────────────────────────────────────────────────
    this.server.tool(
      "skill_read",
      "Load instructions for a skill by key. Bundled skills return full content. Local-registered skills return metadata and local_path only; when local tools are connected, use Computer Use skill_read_local or Studio Harness read_file to load local_path/SKILL.md.",
      {
        skill: z.string().describe("The skill key (e.g. 'product-self-knowledge'). Must match a key from the skills index."),
        user_id: z.string().optional().describe("User id — required to resolve locally-registered skills."),
        runtime: runtimeSchema,
        device_id: z.string().optional(),
      },
      async ({ skill, user_id, runtime, device_id }) => {
        const result = await readSkill(this.env, skill, {
          userId: user_id, runtime, deviceId: device_id,
        });
        if (!result) return text({ found: false, error: `Skill '${skill}' not found` });
        return text(result);
      },
    );

    // ── skill_list ───────────────────────────────────────────────────────────
    this.server.tool(
      "skill_list",
      "List all available skills (bundled system skills + the user's registered local skills). Returns structured metadata per skill, with duplicate keys preserved (shadowedBy flag shows precedence).",
      {
        user_id: z.string().optional(),
        runtime: runtimeSchema,
        device_id: z.string().optional(),
      },
      async ({ user_id, runtime, device_id }) => {
        const skills = await listSkills(this.env, { userId: user_id, runtime, deviceId: device_id });
        return text({ skills, count: skills.length, index: buildSkillIndex(skills) });
      },
    );

    // ── skill_search ────────────────────────────────────────────────────────
    this.server.tool(
      "skill_search",
      "Search skill metadata (key, name, description, category) by token substring. Searches bundled + registered local skills — never indexes local file content.",
      {
        query: z.string().describe("Search query — matched against skill key/name/description/category."),
        user_id: z.string().optional(),
        runtime: runtimeSchema,
        device_id: z.string().optional(),
      },
      async ({ query, user_id, runtime, device_id }) => {
        const skills = await searchSkills(this.env, query, { userId: user_id, runtime, deviceId: device_id });
        return text({ skills, count: skills.length });
      },
    );

    // ── skill_validate ───────────────────────────────────────────────────────
    this.server.tool(
      "skill_validate",
      "Validate a skill.json manifest and/or SKILL.md body. Returns errors (blocking) and warnings. Does not execute anything. Use before registering an imported skill.",
      {
        manifest: z.any().optional().describe("Parsed skill.json object (optional)."),
        skill_md: z.string().optional().describe("Raw SKILL.md text (optional). When manifest is absent, metadata is parsed from frontmatter."),
      },
      async ({ manifest, skill_md }) => {
        const result = validateSkillPackage({ manifest, skillMd: skill_md });
        return text(result);
      },
    );

    // ── skill_register_local ────────────────────────────────────────────────
    this.server.tool(
      "skill_register_local",
      "Register metadata for a local skill that already exists on the user's machine. Does NOT upload skill content — only metadata/manifest. Local content stays under $HOME/.studio/skills.",
      {
        user_id: z.string(),
        key: z.string(),
        name: z.string(),
        description: z.string(),
        category: z.string().optional(),
        version: z.string().optional(),
        allowed_runtime: z.enum(["cloud", "local", "both"]).optional().describe("Defaults to local."),
        source_type: z.enum(["bundled", "local_path", "github"]).optional().describe("Defaults to local_path."),
        source_url: z.string().optional(),
        local_path: z.string().optional(),
        manifest_json: z.string().optional(),
        content_hash: z.string().optional(),
        device_id: z.string().optional(),
      },
      async (args) => {
        try {
          const res = await registerLocalSkill(this.env, {
            userId: args.user_id,
            deviceId: args.device_id ?? null,
            key: args.key,
            name: args.name,
            description: args.description,
            category: args.category ?? null,
            version: args.version ?? null,
            allowedRuntime: args.allowed_runtime,
            sourceType: args.source_type,
            sourceUrl: args.source_url ?? null,
            localPath: args.local_path ?? null,
            manifestJson: args.manifest_json,
            contentHash: args.content_hash ?? null,
          });
          return text({ success: true, id: res.id });
        } catch (e) {
          return text({ success: false, error: e instanceof Error ? e.message : String(e) });
        }
      },
    );

    // ── skill_unregister_local ──────────────────────────────────────────────
    this.server.tool(
      "skill_unregister_local",
      "Remove a registered local skill manifest by key (metadata only — does not delete files on disk).",
      {
        user_id: z.string(),
        key: z.string(),
        device_id: z.string().optional(),
      },
      async ({ user_id, key, device_id }) => {
        const removed = await unregisterLocalSkill(this.env, user_id, key, device_id ?? null);
        return text({ success: true, removed });
      },
    );

    // ── skill_install_plan ──────────────────────────────────────────────────
    this.server.tool(
      "skill_install_plan",
      "Return a safe, reviewable install plan for a GitHub URL or local path descriptor. Never installs directly in the cloud — local content must be installed by a local/desktop runtime. Never runs scripts.",
      {
        source: z.string().describe("GitHub repo URL (https/github.com/owner/repo[/tree/ref/sub]) or local folder path."),
      },
      async ({ source }) => {
        const plan = createInstallPlan(source);
        return text({ plan });
      },
    );
  }
}
