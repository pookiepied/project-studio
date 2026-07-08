import { Type } from "@sinclair/typebox";
import { BaseTool } from "../base/BaseTool";
import { ToolResult, ToolContext } from "../base/types";
import { getRequestEnv } from "../../context";

/**
 * skill_read — shim that delegates to the studio-skills worker.
 *
 * The skill catalog (bundled + local) lives in the studio-skills worker.
 * This tool fetches full skill content by key via the
 * POST /internal/skills/read endpoint.
 *
 * The skill *index* (compact key + description list) is injected into the
 * system prompt by preload.ts via GET /internal/skills/index. This tool is
 * only called when the assistant decides to actually load a skill.
 */
export class SkillReadTool extends BaseTool {
  readonly name = "skill_read";
  readonly description =
    "Load the full instructions for a skill by its key. " +
    "Call this before starting a task that matches a skill listed in the Available Skills section of the system prompt — " +
    "it gives you the complete guidance to follow for that skill.";
  readonly executionTarget = "cloud" as const;
  readonly group = "retrieval" as const;
  readonly tier = 1 as const;
  readonly allowInSubAgent = true;

  readonly parameters = Type.Object({
    skill: Type.String({
      description:
        "The skill key to load (e.g. 'product-self-knowledge'). " +
        "Must exactly match a key from the Available Skills section.",
    }),
  });

  async execute(args: unknown, context?: ToolContext): Promise<ToolResult> {
    const { skill: key = "" } = args as Record<string, string>;
    if (!key) {
      return this.errorResult("Parameter 'skill' is required.");
    }

    const env = getRequestEnv();
    if (!env?.SKILLS) {
      return this.errorResult(
        "Skills service is not available. Cannot load skill content."
      );
    }

    const userId = context?.userContext?.userId ?? "";
    const userContext = context?.userContext as Record<string, unknown> | undefined;
    const localSkillRuntimeAvailable = Boolean(
      userContext?._localSkillRuntimeAvailable ?? userContext?._localEngineConnected
    );
    const runtime = localSkillRuntimeAvailable ? "local" : "cloud";
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const secret = (env as { SKILLS_AUTH_SECRET?: string }).SKILLS_AUTH_SECRET;
    if (secret) headers.Authorization = `Bearer ${secret}`;

    let res: Response;
    try {
      res = await env.SKILLS.fetch(
        new Request("http://studio-skills/internal/skills/read", {
          method:  "POST",
          headers,
          body:    JSON.stringify({ key, userId, runtime }),
        })
      );
    } catch {
      return this.errorResult(`Failed to reach skills service for '${key}'.`);
    }

    if (res.status === 404) {
      const notFound = await res.json<{ error?: string }>().catch(() => ({}) as { error?: string });
      return this.errorResult(
        notFound.error ?? `Skill '${key}' not found. Check the Available Skills section for valid keys.`
      );
    }

    if (!res.ok) {
      return this.errorResult(`Skills service returned HTTP ${res.status} for '${key}'.`);
    }

    const data = await res.json<{
      found?: boolean;
      key?: string;
      category?: string;
      name?: string;
      content?: string;
      localPath?: string | null;
      contentReadable?: boolean;
      note?: string;
    }>();

    if (data.found === false) {
      return this.errorResult(
        `Skill '${key}' not found. Check the Available Skills section for valid keys.`
      );
    }

    return this.successResult({
      skill:            data.key ?? key,
      category:         data.category ?? "",
      name:             data.name ?? key,
      content:          data.content ?? data.note ?? "No content available.",
      localPath:        data.localPath ?? null,
      contentReadable:  data.contentReadable ?? false,
      nextStep:
        data.contentReadable === false && data.localPath
          ? `Load the local skill instructions from ${data.localPath.replace(/[\\/]+$/, "")}/SKILL.md using mcp_computer_use__skill_read_local when Computer Use is connected, or Studio Harness read_file when Studio Harness is connected.`
          : undefined,
    });
  }
}

export const skillReadTool = new SkillReadTool();
