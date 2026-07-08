import type { GatewayEnv }                          from "../env";
import { MODES }                                     from "../services/router/modes";
import { AUTO_MODE, getAutoStaticModel }             from "../services/router/config";
import { verifyBearerToken }                         from "../middleware/auth";
import { addCORSHeaders }                            from "../middleware/cors";

export const MODES_CONFIG_KV_KEY = "admin:modes";
export const AUTO_CONFIG_KV_KEY  = "admin:auto-config";

type ModeOverrides = Record<string, { modelId: string; description: string }>;

interface AutoConfig {
  routerMode: "static" | "dynamic";
  staticModel: string;
  isCustomized: boolean;
}

function extractSlug(modelId: string): string {
  if (modelId.includes("/")) return modelId.split("/").pop()!;
  return modelId.split(":").pop() ?? modelId;
}

function buildDescription(modeId: string, modelId: string): string {
  const slug   = extractSlug(modelId);
  const suffix =
    modeId === "fast"     ? "Instant replies"
    : modeId === "standard" ? "Balanced quality"
    : "Maximum capability";
  return `${slug} · ${suffix}`;
}

function json(data: unknown, status: number, request: Request): Response {
  return addCORSHeaders(
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } }),
    request,
  );
}

async function loadOverrides(env: GatewayEnv): Promise<ModeOverrides> {
  const raw = await env.MODELS_KV.get(MODES_CONFIG_KV_KEY);
  return raw ? (JSON.parse(raw) as ModeOverrides) : {};
}

async function loadAutoConfig(env: GatewayEnv): Promise<AutoConfig> {
  const defaultStaticModel = getAutoStaticModel(env);
  const raw = await env.MODELS_KV.get(AUTO_CONFIG_KV_KEY);
  if (!raw) return { routerMode: AUTO_MODE, staticModel: defaultStaticModel, isCustomized: false };
  const saved = JSON.parse(raw) as { routerMode?: string; staticModel?: string };
  return {
    routerMode: saved.routerMode === "dynamic" ? "dynamic" : "static",
    staticModel: saved.staticModel ?? defaultStaticModel,
    isCustomized: true,
  };
}

function buildResponse(overrides: ModeOverrides, auto: AutoConfig, env: GatewayEnv) {
  const defaultStaticModel = getAutoStaticModel(env);
  return MODES.map((m) => {
    if (m.id === "auto") {
      return {
        ...m,
        defaultModelId:          m.modelId,
        isCustomized:            auto.isCustomized,
        autoRouterMode:          auto.routerMode,
        autoStaticModel:         auto.staticModel,
        autoDefaultStaticModel:  defaultStaticModel,
      };
    }
    const o = overrides[m.id];
    return {
      ...m,
      modelId:       o?.modelId      ?? m.modelId,
      description:   o?.description  ?? m.description,
      defaultModelId: m.modelId,
      isCustomized:  !!o,
    };
  });
}

async function requireAdmin(request: Request, env: GatewayEnv): Promise<true | Response> {
  if (!env.JWT_SECRET) {
    return json({ error: { message: "Admin API is not configured", type: "configuration_error" } }, 503, request);
  }
  const payload = await verifyBearerToken(request, env.JWT_SECRET);
  if (!payload || payload.role !== "admin") {
    return json({ error: { message: "Forbidden", type: "authentication_error" } }, 403, request);
  }
  return true;
}

export async function handleGetAdminModes(request: Request, env: GatewayEnv): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if (auth !== true) return auth;

  const [overrides, auto] = await Promise.all([loadOverrides(env), loadAutoConfig(env)]);
  return json({ data: buildResponse(overrides, auto, env) }, 200, request);
}

export async function handlePutAdminModes(request: Request, env: GatewayEnv): Promise<Response> {
  const auth = await requireAdmin(request, env);
  if (auth !== true) return auth;

  let body: { updates?: Record<string, Record<string, unknown>> };
  try { body = await request.json(); }
  catch { return json({ error: { message: "Invalid JSON body", type: "invalid_request_error" } }, 400, request); }

  if (!body?.updates || typeof body.updates !== "object") {
    return json({ error: { message: "Missing 'updates' object", type: "invalid_request_error" } }, 400, request);
  }

  const validIds = new Set(MODES.map((m) => m.id));
  const [overrides, auto] = await Promise.all([loadOverrides(env), loadAutoConfig(env)]);
  const newAuto = { ...auto };
  let autoChanged = false;

  for (const [id, update] of Object.entries(body.updates)) {
    if (!validIds.has(id)) continue;

    if (id === "auto") {
      if (update.reset) {
        newAuto.routerMode   = AUTO_MODE;
        newAuto.staticModel  = getAutoStaticModel(env);
        newAuto.isCustomized = false;
        autoChanged = true;
      } else {
        if (update.routerMode === "static" || update.routerMode === "dynamic") {
          newAuto.routerMode = update.routerMode as "static" | "dynamic";
          autoChanged = true;
        }
        if (typeof update.staticModel === "string" && update.staticModel.trim()) {
          newAuto.staticModel = update.staticModel.trim();
          autoChanged = true;
        }
        if (autoChanged) newAuto.isCustomized = true;
      }
    } else {
      if (update.reset) {
        delete overrides[id];
      } else if (typeof update.modelId === "string" && update.modelId.trim()) {
        const modelId = update.modelId.trim();
        overrides[id] = { modelId, description: buildDescription(id, modelId) };
      }
    }
  }

  const saves: Promise<unknown>[] = [
    env.MODELS_KV.put(MODES_CONFIG_KV_KEY, JSON.stringify(overrides)),
  ];

  if (autoChanged) {
    saves.push(
      newAuto.isCustomized
        ? env.MODELS_KV.put(AUTO_CONFIG_KV_KEY, JSON.stringify({
            routerMode: newAuto.routerMode,
            staticModel: newAuto.staticModel,
          }))
        : env.MODELS_KV.delete(AUTO_CONFIG_KV_KEY),
    );
  }

  await Promise.all(saves);
  return json({ data: buildResponse(overrides, newAuto, env) }, 200, request);
}
