/**
 * Discovery service — canonical location.
 * Fetches live provider models, populates D1 for admin dashboard.
 * Cron every 6h via scheduled handler. Discovery != exposing.
 */

import { decrypt } from "../infra/encryption.ts";
import { logger } from "../observability/logger.ts";
import { isProtocol, type ModelDefinition } from "../providers/types.ts";
import { getAdapter } from "../providers/registry.ts";
import { ANTHROPIC_STATIC_MODELS } from "../providers/anthropic/discovery.ts";
import { FAL_STATIC_MODELS } from "../providers/third-party/fal/catalog.ts";
import { ELEVENLABS_STATIC_MODELS } from "../providers/third-party/elevenlabs/catalog.ts";
import { batchUpsertCatalogModels } from "./repository.ts";

const STATIC_MODELS: Record<string, ModelDefinition[]> = {
  anthropic: ANTHROPIC_STATIC_MODELS,
  fal: FAL_STATIC_MODELS,
  elevenlabs: ELEVENLABS_STATIC_MODELS,
};

export async function runDiscovery(
  db: D1Database,
  env: { CREDENTIAL_ENCRYPTION_KEY?: string },
  providerId?: string,
): Promise<{ discovered: number; errors: string[] }> {
  let total = 0;
  const errors: string[] = [];

  const providerQuery = providerId
    ? db.prepare("SELECT * FROM providers WHERE enabled = 1 AND id = ?").bind(providerId)
    : db.prepare("SELECT * FROM providers WHERE enabled = 1");
  const providers = await providerQuery.all<{
    id: string;
    name: string;
    base_url: string;
    protocol: string;
  }>();
  for (const p of providers.results ?? []) {
    if (!p.base_url) {
      logger.info("discovery skip provider without configured endpoint", { provider: p.id });
      continue;
    }
    try {
      let models: ModelDefinition[] = [];
      const cred = await db.prepare("SELECT encrypted_key FROM provider_credentials WHERE provider_id = ?").bind(p.id).first<{ encrypted_key: string }>();
      if (!cred) {
        models = STATIC_MODELS[p.id] ?? [];
        if (models.length === 0) {
          logger.info("discovery skip no credential", { provider: p.id });
          continue;
        }
      } else {
        const keyBase64 = env.CREDENTIAL_ENCRYPTION_KEY;
        if (!keyBase64) {
          logger.warn("discovery no encryption key", { provider: p.id });
          models = STATIC_MODELS[p.id] ?? [];
          if (models.length === 0) continue;
        } else {
          const apiKey = await decrypt(cred.encrypted_key, keyBase64);
          if (!isProtocol(p.protocol)) throw new Error(`Unsupported provider protocol: ${p.protocol}`);
          const adapter = getAdapter(p.protocol);
          const fetched = await adapter.discover(apiKey, p.base_url);
          models = fetched.map((m) => ({ ...m, providerId: p.id, catalogSource: "live" }));
        }
      }

      if (models.length > 0) {
        const batchCount = await batchUpsertCatalogModels(db, models);
        total += batchCount;
      }
      logger.info("discovery ok", { provider: p.id, count: models.length });
    } catch (e) {
      const msg = `${p.id}: ${e instanceof Error ? e.message : String(e)}`;
      errors.push(msg);
      logger.error("discovery error", { provider: p.id, error: msg });
      const fallback = STATIC_MODELS[p.id] ?? [];
      if (fallback.length > 0) {
        const batchCount = await batchUpsertCatalogModels(db, fallback);
        total += batchCount;
      }
    }
  }
  return { discovered: total, errors };
}
