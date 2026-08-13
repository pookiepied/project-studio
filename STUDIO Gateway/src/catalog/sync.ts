/**
 * Catalog sync — first-party source of truth from models.dev (`@opencode-ai/models`).
 *
 * Full ingest: every provider + every model. Gating is admin-layer:
 *  - popular set → providers.enabled=1 (loud in UI)
 *  - rest       → providers.enabled=0 (faded, opt-in)
 *  - models     → exposed=0 always (admin must drag to production grid)
 *
 * Two fetch modes share this queue (as requested):
 *  1. catalog mode — this file: static snapshot via @opencode-ai/models, tags all fields
 *  2. live mode    — services/discovery.ts GET /v1/models per credential'd provider,
 *                   merges on top (covers 11labs/fal image/video where catalog is thin)
 */

import { Models } from "@opencode-ai/models";
import { POPULAR_PROVIDER_IDS, MODELS_DEV_TO_REGISTRY } from "./popular.ts";
import { mapModelsDevToDefinition } from "../adapters/sdk.ts";
import { logger } from "../lib/logger.ts";

// Protocol inference from models.dev npm/doc fields
function inferProtocol(npm: string | undefined, api: string | undefined): string {
  if (npm === "@ai-sdk/anthropic") return "anthropic-messages";
  if (npm === "@ai-sdk/google" || npm === "@ai-sdk/google-vertex") return "google-generative-ai";
  if (api?.includes("/v1/responses")) return "openai-responses";
  return "openai-completions";
}

export interface SyncResult {
  providersUpserted: number;
  modelsUpserted: number;
  popularEnabled: number;
  errors: string[];
}

/**
 * Sync entire models.dev catalog into D1. Preserves admin gating:
 * providers.enabled reflects popular allowlist, models.exposed is never auto-set.
 */
export async function syncCatalog(db: D1Database): Promise<SyncResult> {
  const client = Models.make();
  const providers = await client.providers() as Record<string, {
    id: string; name: string; npm?: string; doc?: string; api?: string;
    models: Record<string, {
      id: string; name: string; description?: string;
      modalities: { input: string[]; output: string[] };
      limit: { context: number; output?: number };
      cost: { input?: number; output?: number; cache_read?: number; cache_write?: number };
      tool_call: boolean; reasoning: boolean; reasoning_options?: Array<{ type: string }>;
      attachment?: boolean; release_date?: string;
    }>;
  }>;

  let providersUpserted = 0;
  let modelsUpserted = 0;
  const errors: string[] = [];
  let popularEnabled = 0;

  for (const [devId, p] of Object.entries(providers)) {
    const registryId = MODELS_DEV_TO_REGISTRY[devId] ?? devId;
    const isPopular = POPULAR_PROVIDER_IDS.has(devId) || POPULAR_PROVIDER_IDS.has(registryId);
    const enabled = isPopular ? 1 : 0;
    if (isPopular) popularEnabled++;

    const protocol = inferProtocol(p.npm, p.api);
    const baseUrl = p.api?.replace("${CLOUDFLARE_ACCOUNT_ID}", "account_id")
                          .replace("${NEON_AI_GATEWAY_BASE_URL}", "https://ai-gateway.neon.tech")
                          .replace("${DATABRICKS_HOST}", "databricks.example.com")
                          .replace("${INFOMANIAK_PRODUCT_ID}", "product_id")
                          .replace("${SNOWFLAKE_ACCOUNT}", "account") ?? `https://${devId}.example.com/v1`;

    try {
      await db.prepare(
        `INSERT INTO providers (id, name, base_url, protocol, auth_mode, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'apiKey', ?, unixepoch('now')*1000, unixepoch('now')*1000)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, base_url=excluded.base_url,
           protocol=excluded.protocol, updated_at=excluded.updated_at`,
      ).bind(registryId, p.name ?? devId, baseUrl, protocol, enabled).run();
      providersUpserted++;

      // Upsert models — never auto-expose
      for (const [modelId, m] of Object.entries(p.models)) {
        try {
          const def = mapModelsDevToDefinition(registryId, modelId, m as never);
          const existing = await db.prepare(
            "SELECT exposed, enabled FROM models WHERE provider_id = ? AND model_id = ?",
          ).bind(registryId, modelId).first<{ exposed: number; enabled: number }>();
          const exposed = existing?.exposed ?? 0;
          const now = Date.now();
          await db.prepare(
            `INSERT INTO models (provider_id, model_id, display_name, category, input_modalities, output_modalities,
               context_window, max_output_tokens, pricing_input, pricing_output, pricing_cache_read, pricing_cache_write,
               supports_tools, supports_parallel_tools, supports_vision, supports_reasoning, reasoning_type, reasoning_levels,
               enabled, exposed, raw_json, fetched_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
             ON CONFLICT(provider_id, model_id) DO UPDATE SET
               display_name=excluded.display_name, category=excluded.category,
               input_modalities=excluded.input_modalities, output_modalities=excluded.output_modalities,
               context_window=excluded.context_window, max_output_tokens=excluded.max_output_tokens,
               pricing_input=excluded.pricing_input, pricing_output=excluded.pricing_output,
               pricing_cache_read=excluded.pricing_cache_read, pricing_cache_write=excluded.pricing_cache_write,
               supports_tools=excluded.supports_tools, supports_parallel_tools=excluded.supports_parallel_tools,
               supports_vision=excluded.supports_vision, supports_reasoning=excluded.supports_reasoning,
               reasoning_type=excluded.reasoning_type, reasoning_levels=excluded.reasoning_levels,
               raw_json=excluded.raw_json, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
          ).bind(
            registryId, modelId, def.displayName ?? modelId, def.category,
            JSON.stringify(def.inputModalities), JSON.stringify(def.outputModalities),
            def.contextWindow, def.maxOutputTokens,
            def.pricing?.input ?? null, def.pricing?.output ?? null,
            def.pricing?.cacheRead ?? null, def.pricing?.cacheWrite ?? null,
            def.supportsTools ? 1 : 0, def.supportsParallelTools ? 1 : 0,
            def.supportsVision ? 1 : 0, def.supportsReasoning ? 1 : 0,
            def.reasoning?.type ?? null,
            def.reasoning ? JSON.stringify(def.reasoning.levels) : null,
            exposed, JSON.stringify(m), now, now,
          ).run();
          modelsUpserted++;
        } catch (e) {
          errors.push(`${registryId}/${modelId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    } catch (e) {
      const msg = `${devId}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      logger.error("catalog sync provider", { provider: devId, error: msg });
    }
  }

  logger.info("catalog sync done", { providersUpserted, modelsUpserted, popularEnabled, errors: errors.length });
  return { providersUpserted, modelsUpserted, popularEnabled, errors };
}

/**
 * Live fetch for a single provider's /v1/models (second queue mode).
 * Used for credential'd providers, especially custom image/video/audio
 * (fal, elevenlabs) where catalog has no entry. Merges into same table.
 */
export async function syncLiveProvider(
  db: D1Database,
  providerId: string,
  apiKey: string,
  baseUrl: string,
  protocol: string,
): Promise<number> {
  const { getAdapter } = await import("../providers/registry.ts");
  const adapter = getAdapter(protocol as never);
  const models = await adapter.discover(apiKey, baseUrl);
  let count = 0;
  for (const m of models) {
    const existing = await db.prepare(
      "SELECT exposed FROM models WHERE provider_id = ? AND model_id = ?",
    ).bind(providerId, m.id).first<{ exposed: number }>();
    const exposed = existing?.exposed ?? 0;
    const now = Date.now();
    await db.prepare(
      `INSERT INTO models (provider_id, model_id, display_name, category, input_modalities, output_modalities,
         context_window, max_output_tokens, pricing_input, pricing_output, pricing_cache_read, pricing_cache_write,
         supports_tools, supports_parallel_tools, supports_vision, supports_reasoning, reasoning_type, reasoning_levels,
         enabled, exposed, raw_json, fetched_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
       ON CONFLICT(provider_id, model_id) DO UPDATE SET
         display_name=excluded.display_name, category=excluded.category,
         input_modalities=excluded.input_modalities, output_modalities=excluded.output_modalities,
         context_window=excluded.context_window, max_output_tokens=excluded.max_output_tokens,
         raw_json=excluded.raw_json, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
    ).bind(
      providerId, m.id, m.displayName ?? m.id, m.category,
      JSON.stringify(m.inputModalities), JSON.stringify(m.outputModalities),
      m.contextWindow, m.maxOutputTokens,
      m.pricing?.input ?? null, m.pricing?.output ?? null,
      m.pricing?.cacheRead ?? null, m.pricing?.cacheWrite ?? null,
      m.supportsTools ? 1 : 0, m.supportsParallelTools ? 1 : 0,
      m.supportsVision ? 1 : 0, m.supportsReasoning ? 1 : 0,
      m.reasoning?.type ?? null, m.reasoning ? JSON.stringify(m.reasoning.levels) : null,
      exposed, JSON.stringify(m.raw ?? {}), now, now,
    ).run();
    count++;
  }
  return count;
}
