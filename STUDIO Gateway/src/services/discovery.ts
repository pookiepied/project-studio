/**
 * Discovery service - fetches all provider models, populates D1 for admin dashboard.
 * Cron every 6h via scheduled handler. Discovery != exposing.
 * - Discovery populates every field it can (pricing, context_window, categories, reasoning)
 * - Exposing is admin toggle via PATCH /admin/providers/:id/models/:modelId {exposed:true}
 * By default nothing is exposed; gateway /v1/models only returns exposed.
 */

import { decrypt } from "../lib/encryption.ts";
import { logger } from "../lib/logger.ts";
import type { ModelDefinition } from "../providers/types.ts";
import { getAdapter } from "../providers/registry.ts";
import { ANTHROPIC_STATIC_MODELS } from "../providers/anthropic/discovery.ts";
import { FAL_STATIC_MODELS } from "../providers/custom/fal.ts";
import { ELEVENLABS_STATIC_MODELS } from "../providers/custom/elevenlabs.ts";

export async function runDiscovery(db: D1Database, env: { CREDENTIAL_ENCRYPTION_KEY?: string }): Promise<{ discovered: number; errors: string[] }> {
  let total = 0;
  const errors: string[] = [];

  // Mode A: catalog sync is now separate (POST /admin/catalog/sync); discovery here is live-only (Mode B).
  // Mode B: live GET /v1/models per credential'd enabled provider + static fallbacks for custom.
  const providers = await db.prepare("SELECT * FROM providers WHERE enabled = 1").all<{
    id: string;
    name: string;
    base_url: string;
    protocol: string;
  }>();
  for (const p of providers.results ?? []) {
    try {
      let models: ModelDefinition[] = [];
      const cred = await db.prepare("SELECT encrypted_key FROM provider_credentials WHERE provider_id = ?").bind(p.id).first<{ encrypted_key: string }>();
      if (!cred) {
        // No credential -> static fallbacks only (catalog already seeded via /admin/catalog/sync)
        if (p.id === "anthropic") models = ANTHROPIC_STATIC_MODELS;
        else if (p.id === "fal") models = FAL_STATIC_MODELS;
        else if (p.id === "elevenlabs") models = ELEVENLABS_STATIC_MODELS;
        else {
          logger.info("discovery skip no credential", { provider: p.id });
          continue;
        }
      } else {
        const keyBase64 = env.CREDENTIAL_ENCRYPTION_KEY;
        if (!keyBase64) {
          logger.warn("discovery no encryption key", { provider: p.id });
          if (p.id === "anthropic") models = ANTHROPIC_STATIC_MODELS;
          else if (p.id === "fal") models = FAL_STATIC_MODELS;
          else if (p.id === "elevenlabs") models = ELEVENLABS_STATIC_MODELS;
          else continue;
        } else {
          const apiKey = await decrypt(cred.encrypted_key, keyBase64);
          const adapter = getAdapter(p.protocol as never);
          const fetched = await adapter.discover(apiKey, p.base_url);
          models = fetched.map((m) => ({ ...m, providerId: p.id }));
        }
      }

      for (const m of models) {
        await upsertModel(db, m);
        total++;
      }
      logger.info("discovery ok", { provider: p.id, count: models.length });
    } catch (e) {
      const msg = `${p.id}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      logger.error("discovery error", { provider: p.id, error: msg });
      if (p.id === "anthropic") {
        for (const m of ANTHROPIC_STATIC_MODELS) {
          await upsertModel(db, m);
          total++;
        }
      } else if (p.id === "fal") {
        for (const m of FAL_STATIC_MODELS) {
          await upsertModel(db, m);
          total++;
        }
      } else if (p.id === "elevenlabs") {
        for (const m of ELEVENLABS_STATIC_MODELS) {
          await upsertModel(db, m);
          total++;
        }
      }
    }
  }
  return { discovered: total, errors };
}

async function upsertModel(db: D1Database, m: ModelDefinition): Promise<void> {
  const existing = await db
    .prepare("SELECT exposed, enabled FROM models WHERE provider_id = ? AND model_id = ?")
    .bind(m.providerId, m.id)
    .first<{ exposed: number; enabled: number }>();
  // Preserve admin exposed flag; discovery never auto-exposes
  const exposed = existing?.exposed ?? 0;
  const now = Date.now();
  await db
    .prepare(
      `INSERT INTO models (
        provider_id, model_id, display_name, category, input_modalities, output_modalities,
        context_window, max_output_tokens,
        pricing_input, pricing_output, pricing_cache_read, pricing_cache_write,
        supports_tools, supports_parallel_tools, supports_vision, supports_reasoning,
        reasoning_type, reasoning_levels,
        enabled, exposed, raw_json, fetched_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)
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
    )
    .bind(
      m.providerId,
      m.id,
      m.displayName ?? null,
      m.category,
      JSON.stringify(m.inputModalities),
      JSON.stringify(m.outputModalities),
      m.contextWindow,
      m.maxOutputTokens,
      m.pricing?.input ?? null,
      m.pricing?.output ?? null,
      m.pricing?.cacheRead ?? null,
      m.pricing?.cacheWrite ?? null,
      m.supportsTools ? 1 : 0,
      m.supportsParallelTools ? 1 : 0,
      m.supportsVision ? 1 : 0,
      m.supportsReasoning ? 1 : 0,
      m.reasoning?.type ?? null,
      m.reasoning ? JSON.stringify(m.reasoning.levels) : null,
      exposed,
      m.raw ? JSON.stringify(m.raw) : null,
      now,
      now,
    )
    .run();
}
