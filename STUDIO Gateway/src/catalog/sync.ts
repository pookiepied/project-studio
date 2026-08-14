/**
 * Catalog sync — first-party source of truth from models.dev (`@opencode-ai/models`).
 *
 * Full ingest: every provider + every model. Gating is admin-layer:
 *  - popular set → providers.enabled=1 for NEW providers only (loud in UI)
 *  - rest       → providers.enabled=0 for NEW providers (faded, opt-in)
 *  - existing providers → enabled preserved (operator-owned)
 *  - models     → exposed=0 always (admin must drag to production grid)
 *
 * Live discovery is a separate job, but it writes through the same catalog
 * repository so both sources produce the same D1 shape.
 */

import { Models } from "@opencode-ai/models";
import { POPULAR_PROVIDER_IDS, MODELS_DEV_TO_REGISTRY } from "./enabled-allowlist.ts";
import { resolveProviderUrl, inferProtocol } from "./defaults.ts";
import { mapModelsDevToDefinition } from "./mapper.ts";
import { logger } from "../observability/logger.ts";
import { batchUpsertCatalogModels } from "./repository.ts";

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
      id: string; name: string; description?: string; family?: string;
      modalities: { input: string[]; output: string[] };
      limit: { context: number; output?: number };
      cost?: { input?: number; output?: number; cache_read?: number; cache_write?: number };
      tool_call: boolean; reasoning: boolean; reasoning_options?: Array<{ type: string }>;
      attachment?: boolean; release_date?: string; open_weights?: boolean; knowledge?: string; lab?: string;
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
    const baseUrl = resolveProviderUrl(devId, registryId, p.api);

    try {
      // Preserve operator-owned `enabled` — only set for new providers, never overwrite existing
      await db.prepare(
        `INSERT INTO providers (id, name, base_url, protocol, auth_mode, enabled, catalog_source, doc_url, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'apiKey', ?, 'models.dev', ?, unixepoch('now')*1000, unixepoch('now')*1000)
         ON CONFLICT(id) DO UPDATE SET name=excluded.name, base_url=excluded.base_url,
           protocol=excluded.protocol, catalog_source=excluded.catalog_source,
           doc_url=excluded.doc_url, updated_at=excluded.updated_at`,
      ).bind(registryId, p.name ?? devId, baseUrl, protocol, enabled, p.doc ?? null).run();
      providersUpserted++;

      // Batch upsert models — never auto-expose, preserves existing flags via batch
      const defs: import("../providers/types.ts").ModelDefinition[] = [];
      for (const [modelId, m] of Object.entries(p.models)) {
        try {
          defs.push(mapModelsDevToDefinition(registryId, modelId, m as never));
        } catch (e) {
          errors.push(`${registryId}/${modelId}: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
      if (defs.length > 0) {
        const batchCount = await batchUpsertCatalogModels(db, defs);
        modelsUpserted += batchCount;
        logger.info("catalog sync provider batch", { provider: registryId, models: batchCount });
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
