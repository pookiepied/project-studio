/**
 * Catalog persistence. Every catalog source uses this writer so admin flags
 * and the expanded catalog metadata behave identically for models.dev, live
 * discovery, and built-in fallbacks.
 */

import type { ModelDefinition } from "../providers/types.ts";

export const CATALOG_BATCH_SIZE = 100;

export function prepareUpsertCatalogModel(db: D1Database, model: ModelDefinition, existing: { exposed: number; enabled: number } | null): D1PreparedStatement {
  const exposed = existing?.exposed ?? 0;
  const enabled = existing?.enabled ?? 1;
  const now = Date.now();
  const raw = model.raw ? JSON.stringify(model.raw) : null;
  const source = model.catalogSource ?? getRawSource(model.raw) ?? "live";

  return db.prepare(
    `INSERT INTO models (
        provider_id, model_id, display_name, category, input_modalities, output_modalities,
        context_window, max_output_tokens,
        pricing_input, pricing_output, pricing_cache_read, pricing_cache_write,
        supports_tools, supports_parallel_tools, supports_vision, supports_reasoning,
        reasoning_type, reasoning_levels,
        family, lab, open_weights, knowledge_cutoff, catalog_source,
        enabled, exposed, raw_json, fetched_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_id, model_id) DO UPDATE SET
        display_name=excluded.display_name, category=excluded.category,
        input_modalities=excluded.input_modalities, output_modalities=excluded.output_modalities,
        context_window=excluded.context_window, max_output_tokens=excluded.max_output_tokens,
        pricing_input=excluded.pricing_input, pricing_output=excluded.pricing_output,
        pricing_cache_read=excluded.pricing_cache_read, pricing_cache_write=excluded.pricing_cache_write,
        supports_tools=excluded.supports_tools, supports_parallel_tools=excluded.supports_parallel_tools,
        supports_vision=excluded.supports_vision, supports_reasoning=excluded.supports_reasoning,
        reasoning_type=excluded.reasoning_type, reasoning_levels=excluded.reasoning_levels,
        family=excluded.family, lab=excluded.lab, open_weights=excluded.open_weights,
        knowledge_cutoff=excluded.knowledge_cutoff, catalog_source=excluded.catalog_source,
        raw_json=excluded.raw_json, fetched_at=excluded.fetched_at, updated_at=excluded.updated_at`,
  ).bind(
    model.providerId,
    model.id,
    model.displayName ?? null,
    model.category,
    JSON.stringify(model.inputModalities),
    JSON.stringify(model.outputModalities),
    model.contextWindow,
    model.maxOutputTokens,
    model.pricing?.input ?? null,
    model.pricing?.output ?? null,
    model.pricing?.cacheRead ?? null,
    model.pricing?.cacheWrite ?? null,
    model.supportsTools ? 1 : 0,
    model.supportsParallelTools ? 1 : 0,
    model.supportsVision ? 1 : 0,
    model.supportsReasoning ? 1 : 0,
    model.reasoning?.type ?? null,
    model.reasoning ? JSON.stringify(model.reasoning.levels) : null,
    model.family ?? null,
    model.lab ?? null,
    model.openWeights ? 1 : 0,
    model.knowledgeCutoff ?? null,
    source,
    enabled,
    exposed,
    raw,
    now,
    now,
  );
}

export async function upsertCatalogModel(db: D1Database, model: ModelDefinition): Promise<void> {
  const existing = await db
    .prepare("SELECT exposed, enabled FROM models WHERE provider_id = ? AND model_id = ?")
    .bind(model.providerId, model.id)
    .first<{ exposed: number; enabled: number }>();
  await prepareUpsertCatalogModel(db, model, existing).run();
}

export async function batchUpsertCatalogModels(db: D1Database, models: ModelDefinition[]): Promise<number> {
  if (models.length === 0) return 0;
  // Group by provider to allow single SELECT per provider for exposed/enabled preservation
  const byProvider = new Map<string, ModelDefinition[]>();
  for (const m of models) {
    const arr = byProvider.get(m.providerId) ?? [];
    arr.push(m);
    byProvider.set(m.providerId, arr);
  }
  let upserted = 0;
  for (const [providerId, providerModels] of byProvider) {
    // Fetch existing flags for this provider's models in one query
    const ids = providerModels.map((m) => m.id);
    // D1 doesn't support bulk IN with variable placeholders easily for large sets, chunk per CATALOG_BATCH_SIZE
    for (let i = 0; i < ids.length; i += CATALOG_BATCH_SIZE) {
      const chunkIds = ids.slice(i, i + CATALOG_BATCH_SIZE);
      const chunkModels = providerModels.slice(i, i + CATALOG_BATCH_SIZE);
      const placeholders = chunkIds.map(() => "?").join(",");
      const existingRows = await db
        .prepare(`SELECT model_id, exposed, enabled FROM models WHERE provider_id = ? AND model_id IN (${placeholders})`)
        .bind(providerId, ...chunkIds)
        .all<{ model_id: string; exposed: number; enabled: number }>();
      const existingMap = new Map<string, { exposed: number; enabled: number }>();
      for (const r of existingRows.results ?? []) existingMap.set(r.model_id, { exposed: r.exposed, enabled: r.enabled });
      const stmts: D1PreparedStatement[] = [];
      for (const m of chunkModels) {
        const existing = existingMap.get(m.id) ?? null;
        stmts.push(prepareUpsertCatalogModel(db, m, existing));
      }
      if (stmts.length > 0) {
        const batchFn = (db as unknown as { batch?: (stmts: D1PreparedStatement[]) => Promise<unknown> }).batch;
        if (typeof batchFn === "function") {
          await batchFn.call(db, stmts);
        } else {
          // Fallback for test mocks without batch support
          for (const s of stmts) await s.run();
        }
        upserted += stmts.length;
      }
    }
  }
  return upserted;
}

function getRawSource(raw: unknown): string | null {
  if (!raw || typeof raw !== "object") return null;
  const source = (raw as Record<string, unknown>).source;
  return typeof source === "string" ? source : null;
}
