import type { Env } from "../env";
import { json, validateAuth, str } from "./responses";
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

type Query = { userId?: string; deviceId?: string; runtime?: "cloud" | "local" };

function queryFrom(params: URLSearchParams): Query {
  const runtime = params.get("runtime");
  return {
    userId: params.get("userId") ?? undefined,
    deviceId: params.get("deviceId") ?? undefined,
    runtime: runtime === "local" ? "local" : "cloud",
  };
}

async function readBody(request: Request): Promise<Record<string, unknown> | null> {
  try { return (await request.json()) as Record<string, unknown>; }
  catch { return null; }
}

/**
 * Internal REST routes. Not public — reached only via service bindings (chat
 * preload, api proxy). All routes require SKILLS_AUTH_SECRET when configured.
 */
export async function handleInternalRoutes(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response | null> {
  const path = url.pathname;
  const method = request.method;

  if (!path.startsWith("/internal/skills")) return null;
  if (!validateAuth(request, env)) return json({ error: "Unauthorized" }, 401);

  // ── GET /internal/skills/index?userId=&runtime=&deviceId= ─────────────────
  if (path === "/internal/skills/index" && method === "GET") {
    const q = queryFrom(url.searchParams);
    const skills = await listSkills(env, q);
    return json({ index: buildSkillIndex(skills), count: skills.filter((s) => !s.shadowedBy).length });
  }

  // Everything below is POST with a JSON body.
  if (method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = await readBody(request);
  if (!body) return json({ error: "Invalid JSON body" }, 400);

  // ── POST /internal/skills/list ───────────────────────────────────────────
  if (path === "/internal/skills/list") {
    const q: Query = {
      userId: str(body, "userId") || undefined,
      deviceId: str(body, "deviceId") || undefined,
      runtime: (body["runtime"] === "local" ? "local" : "cloud") as Query["runtime"],
    };
    const skills = await listSkills(env, q);
    return json({ skills, count: skills.length });
  }

  // ── POST /internal/skills/read ────────────────────────────────────────────
  if (path === "/internal/skills/read") {
    const key = str(body, "key");
    if (!key) return json({ error: "key is required" }, 400);
    const q: Query = {
      userId: str(body, "userId") || undefined,
      deviceId: str(body, "deviceId") || undefined,
      runtime: (body["runtime"] === "local" ? "local" : "cloud") as Query["runtime"],
    };
    const result = await readSkill(env, key, q);
    if (!result) return json({ found: false, error: `Skill '${key}' not found` }, 404);
    return json(result);
  }

  // ── POST /internal/skills/search ──────────────────────────────────────────
  if (path === "/internal/skills/search") {
    const query = str(body, "query");
    const q: Query = {
      userId: str(body, "userId") || undefined,
      deviceId: str(body, "deviceId") || undefined,
      runtime: (body["runtime"] === "local" ? "local" : "cloud") as Query["runtime"],
    };
    const skills = await searchSkills(env, query, q);
    return json({ skills, count: skills.length });
  }

  // ── POST /internal/skills/validate ────────────────────────────────────────
  if (path === "/internal/skills/validate") {
    const result = validateSkillPackage({
      manifest: body["manifest"],
      skillMd: typeof body["skillMd"] === "string" ? (body["skillMd"] as string) : undefined,
    });
    return json(result);
  }

  // ── POST /internal/skills/register-local ──────────────────────────────────
  if (path === "/internal/skills/register-local") {
    const userId = str(body, "userId");
    const key = str(body, "key");
    if (!userId || !key) return json({ error: "userId and key are required" }, 400);
    try {
      const res = await registerLocalSkill(env, {
        userId,
        deviceId: str(body, "deviceId") || null,
        key,
        name: str(body, "name"),
        description: str(body, "description"),
        category: str(body, "category") || null,
        version: str(body, "version") || null,
        allowedRuntime: (["cloud", "local", "both"].includes(String(body["allowed_runtime"]))
          ? (body["allowed_runtime"] as "cloud" | "local" | "both")
          : "local"),
        sourceType: (["bundled", "local_path", "github"].includes(String(body["source_type"]))
          ? (body["source_type"] as "bundled" | "local_path" | "github")
          : "local_path"),
        sourceUrl: str(body, "source_url") || null,
        localPath: str(body, "local_path") || null,
        manifestJson: typeof body["manifest_json"] === "string" ? (body["manifest_json"] as string) : "{}",
        contentHash: str(body, "content_hash") || null,
        enabled: body["enabled"] !== false,
      });
      return json({ success: true, id: res.id });
    } catch (e) {
      return json({ success: false, error: e instanceof Error ? e.message : String(e) }, 400);
    }
  }

  // ── POST /internal/skills/unregister-local ───────────────────────────────
  if (path === "/internal/skills/unregister-local") {
    const userId = str(body, "userId");
    const key = str(body, "key");
    if (!userId || !key) return json({ error: "userId and key are required" }, 400);
    const removed = await unregisterLocalSkill(env, userId, key, str(body, "deviceId") || null);
    return json({ success: true, removed });
  }

  // ── POST /internal/skills/heartbeat-local ─────────────────────────────────
  if (path === "/internal/skills/heartbeat-local") {
    const userId = str(body, "userId");
    const key = str(body, "key");
    if (!userId || !key) return json({ error: "userId and key are required" }, 400);
    const touched = await heartbeatLocalSkill(env, userId, key, str(body, "deviceId") || null);
    return json({ success: true, touched });
  }

  // ── POST /internal/skills/install-plan ────────────────────────────────────
  if (path === "/internal/skills/install-plan") {
    const source = str(body, "source");
    if (!source) return json({ error: "source is required" }, 400);
    const plan = createInstallPlan(source);
    return json({ plan });
  }

  return json({ error: "Not found" }, 404);
}
