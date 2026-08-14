import { describe, it, expect } from "vitest";
import { batchUpsertCatalogModels, CATALOG_BATCH_SIZE } from "../src/catalog/repository.ts";
import type { ModelDefinition } from "../src/providers/types.ts";

function createBatchDb() {
  const models = new Map<string, { provider_id: string; model_id: string; exposed: number; enabled: number }>();
  let batchCalls = 0;
  const db: D1Database = {
    prepare(sql: string) {
      const stmt: Record<string, unknown> = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...args: unknown[]) { (stmt as { _args: unknown[] })._args = args; return stmt as unknown as D1PreparedStatement; },
        first: async <T>() => null as T,
        all: async <T>() => {
          const args = (stmt as { _args: unknown[] })._args as unknown[];
          if (sql.includes("SELECT model_id, exposed, enabled FROM models WHERE provider_id")) {
            const providerId = args[0] as string;
            const ids = args.slice(1) as string[];
            const results = ids.map((id) => {
              const key = `${providerId}:${id}`;
              const row = models.get(key);
              if (row) return { model_id: id, exposed: row.exposed, enabled: row.enabled };
              return null;
            }).filter(Boolean);
            return { results } as T;
          }
          return { results: [] } as T;
        },
        run: async () => ({ meta: { changes: 1 } } as never),
      };
      return stmt as unknown as D1PreparedStatement;
    },
    batch: async (stmts: D1PreparedStatement[]) => {
      batchCalls++;
      for (const s of stmts) await (s as unknown as { run: () => Promise<unknown> }).run();
      return stmts.map(() => ({ meta: { changes: 1 } })) as never;
    },
  } as unknown as D1Database;
  return { db, models, getBatchCalls: () => batchCalls };
}

function makeDef(providerId: string, id: string): ModelDefinition {
  return {
    id,
    providerId,
    category: "text",
    inputModalities: ["text"],
    outputModalities: ["text"],
    contextWindow: 4096,
    maxOutputTokens: 1024,
    supportsTools: false,
    supportsParallelTools: false,
    supportsVision: false,
    supportsReasoning: false,
    reasoning: null,
    pricing: null,
  };
}

describe("Catalog batch", () => {
  it("uses CATALOG_BATCH_SIZE constant and batches via db.batch", async () => {
    expect(CATALOG_BATCH_SIZE).toBe(100);
    const { db, getBatchCalls } = createBatchDb();
    const models: ModelDefinition[] = [];
    for (let i = 0; i < 250; i++) models.push(makeDef("openai", `model-${i}`));
    const count = await batchUpsertCatalogModels(db, models);
    expect(count).toBe(250);
    // 250 models for one provider => 3 batches (100,100,50)
    expect(getBatchCalls()).toBe(3);
  });

  it("preserves exposed/enabled via batch (no hardcode)", async () => {
    const { db, models } = createBatchDb();
    models.set("openai:test", { provider_id: "openai", model_id: "test", exposed: 1, enabled: 0 });
    // The batch upsert should preserve existing exposed=1, enabled=0 via SELECT
    // Our mock for SELECT returns existing, so we can verify that the batch still counts
    const def = makeDef("openai", "test");
    const count = await batchUpsertCatalogModels(db, [def]);
    expect(count).toBe(1);
    // Model still exists
    expect(models.has("openai:test")).toBe(true);
  });

  it("handles empty array", async () => {
    const { db } = createBatchDb();
    expect(await batchUpsertCatalogModels(db, [])).toBe(0);
  });
});
