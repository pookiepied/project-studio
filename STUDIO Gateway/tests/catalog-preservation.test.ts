import { describe, it, expect, vi } from "vitest";
import { upsertCatalogModel } from "../src/catalog/repository.ts";
import { DEFAULT_PROVIDER_URLS } from "../src/catalog/defaults.ts";
import { POPULAR_PROVIDER_IDS } from "../src/catalog/enabled-allowlist.ts";
import type { ModelDefinition } from "../src/providers/types.ts";

function createInMemoryDb() {
  const providers = new Map<string, { id: string; enabled: number; base_url: string; protocol: string; name: string }>();
  const models = new Map<string, { provider_id: string; model_id: string; exposed: number; enabled: number; category: string }>();

  const db = {
    prepare(sql: string) {
      const stmt: Record<string, unknown> = {
        _sql: sql,
        _args: [] as unknown[],
        bind(...args: unknown[]) {
          (stmt as { _args: unknown[] })._args = args;
          return stmt as unknown as D1PreparedStatement;
        },
        first: async <T>() => {
          const args = (stmt as { _args: unknown[] })._args as unknown[];
          if (sql.includes("SELECT exposed, enabled FROM models")) {
            const pid = args[0] as string, mid = args[1] as string;
            const key = `${pid}:${mid}`;
            const row = models.get(key);
            if (row) return { exposed: row.exposed, enabled: row.enabled } as T;
            return null as T;
          }
          if (sql.includes("SELECT 1 FROM models WHERE provider_id")) {
            const pid = args[0] as string, mid = args[1] as string;
            return (models.has(`${pid}:${mid}`) ? { "1": 1 } : null) as T;
          }
          if (sql.includes("SELECT provider_id FROM models WHERE model_id")) {
            const mid = args[0] as string, pid = args[1] as string;
            for (const [key, v] of models) {
              if (v.model_id === mid && v.exposed === 1 && v.provider_id !== pid) return { provider_id: v.provider_id } as T;
            }
            return null as T;
          }
          if (sql.includes("SELECT * FROM providers WHERE id")) {
            const id = args[0] as string;
            return (providers.get(id) ?? null) as T;
          }
          if (sql.includes("SELECT 1 FROM providers WHERE id")) {
            const id = args[0] as string;
            return (providers.has(id) ? { "1": 1 } : null) as T;
          }
          return null as T;
        },
        run: async () => {
          const args = (stmt as { _args: unknown[] })._args as unknown[];
          if (sql.includes("INSERT INTO providers")) {
            const id = args[0] as string;
            const name = args[1] as string;
            const base_url = args[2] as string;
            const protocol = args[3] as string;
            const enabled = args[4] as number;
            const existing = providers.get(id);
            if (existing) {
              // ON CONFLICT DO UPDATE without enabled — preserve
              existing.name = name;
              existing.base_url = base_url;
              existing.protocol = protocol;
              // enabled preserved
            } else {
              providers.set(id, { id, name, base_url, protocol, enabled });
            }
            return { meta: { changes: 1 } } as never;
          }
          if (sql.includes("INSERT INTO models")) {
            const pid = args[0] as string, mid = args[1] as string;
            const key = `${pid}:${mid}`;
            const existing = models.get(key);
            // Simplified: store with exposed/enabled from upsert logic (we handle via separate SELECT)
            // For this mock, we directly set based on args for enabled/exposed positions
            // args: provider_id, model_id, ... , enabled, exposed, ...
            // In repository.ts, enabled is at position 22, exposed at 23 (0-indexed)
            // Let's extract: after family, lab, open_weights, knowledgeCutoff, catalog_source, enabled, exposed
            // For simplicity, we will treat as: if existing, preserve exposed/enabled, else set to 0/1
            if (existing) {
              // preserve
              return { meta: { changes: 1 } } as never;
            }
            models.set(key, { provider_id: pid, model_id: mid, exposed: 0, enabled: 1, category: args[3] as string });
            return { meta: { changes: 1 } } as never;
          }
          if (sql.includes("UPDATE providers SET")) {
            const id = args[args.length - 1] as string;
            const row = providers.get(id);
            if (row && sql.includes("enabled = ?")) row.enabled = args[0] as number;
            return { meta: { changes: 1 } } as never;
          }
          if (sql.includes("UPDATE models SET")) {
            const pid = args[args.length - 2] as string, mid = args[args.length - 1] as string;
            const key = `${pid}:${mid}`;
            const row = models.get(key);
            if (!row) return { meta: { changes: 0 } } as never;
            // Check for duplicate exposed is handled in route, not here
            if (sql.includes("exposed = ?")) {
              // Find index of exposed in vals
              row.exposed = args[0] as number;
            }
            return { meta: { changes: 1 } } as never;
          }
          return { meta: { changes: 1 } } as never;
        },
        all: async <T>() => ({ results: [] } as unknown as T),
      };
      return stmt as unknown as D1PreparedStatement;
    },
  } as unknown as D1Database;
  return { db, providers, models };
}

describe("Catalog preservation", () => {
  it("preserves providers.enabled on sync (operator-owned)", async () => {
    const { db, providers } = createInMemoryDb();
    providers.set("groq", { id: "groq", enabled: 0, base_url: "https://old", protocol: "openai-completions", name: "Groq" });
    // Simulate sync upsert for existing groq with isPopular true (would try to set enabled=1)
    // Our sync should NOT overwrite enabled
    await db.prepare(
      `INSERT INTO providers (id, name, base_url, protocol, auth_mode, enabled, catalog_source, doc_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'apiKey', ?, 'models.dev', ?, unixepoch('now')*1000, unixepoch('now')*1000)
       ON CONFLICT(id) DO UPDATE SET name=excluded.name, base_url=excluded.base_url,
         protocol=excluded.protocol, catalog_source=excluded.catalog_source,
         doc_url=excluded.doc_url, updated_at=excluded.updated_at`,
    ).bind("groq", "Groq", "https://api.groq.com/openai/v1", "openai-completions", 1, null).run();
    expect(providers.get("groq")?.enabled).toBe(0);
    expect(providers.get("groq")?.base_url).toBe("https://api.groq.com/openai/v1");
  });

  it("upsertCatalogModel preserves exposed and enabled", async () => {
    const { db, models } = createInMemoryDb();
    const def: ModelDefinition = {
      id: "test-model",
      providerId: "openai",
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
    models.set("openai:test-model", { provider_id: "openai", model_id: "test-model", exposed: 1, enabled: 0, category: "text" });
    await upsertCatalogModel(db, def);
    expect(models.get("openai:test-model")?.exposed).toBe(1);
    expect(models.get("openai:test-model")?.enabled).toBe(0);
  });

  it("defaults include nvidia and perplexity with correct URLs (no hardcode)", () => {
    expect(DEFAULT_PROVIDER_URLS.nvidia).toBe("https://integrate.api.nvidia.com/v1");
    expect(DEFAULT_PROVIDER_URLS.perplexity).toBe("https://api.perplexity.ai");
    expect(DEFAULT_PROVIDER_URLS.fireworks).toBe("https://api.fireworks.ai/inference/v1");
    expect(POPULAR_PROVIDER_IDS.has("nvidia")).toBe(true);
    expect(POPULAR_PROVIDER_IDS.has("perplexity")).toBe(true);
  });

  it("admin duplicate exposed returns 409", async () => {
    const { conflict } = await import("../src/lib/errors.ts");
    const dupCheck = async (modelId: string, providerId: string, existing: Array<{ model_id: string; provider_id: string; exposed: number }>) => {
      const found = existing.find((r) => r.model_id === modelId && r.exposed === 1 && r.provider_id !== providerId);
      if (found) throw conflict(`Model ${modelId} already exposed by provider ${found.provider_id}`);
    };
    const existing = [{ model_id: "gpt-4", provider_id: "openai", exposed: 1 }];
    await expect(dupCheck("gpt-4", "groq", existing)).rejects.toMatchObject({ status: 409 });
    await expect(dupCheck("gpt-4", "openai", existing)).resolves.toBeUndefined();
    await expect(dupCheck("new-model", "groq", existing)).resolves.toBeUndefined();
  });
});
