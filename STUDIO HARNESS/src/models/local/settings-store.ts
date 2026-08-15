import { AppSettings, type NamespacedSettings } from "../../storage/app-settings.js";
import type { StudioDatabase } from "../../storage/database.js";
import { StorageError } from "../../storage/errors.js";
import { normalizeCustomProvider, type CustomProviderConfig } from "./config.js";

/**
 * Durable provider settings.
 *
 * This is the non-secret half of BYOK. The API key is in the OS keychain; what
 * lives here is everything the keychain cannot answer — which providers the
 * user connected, what a user-declared endpoint is, and which model the stable
 * alias should route to. A keychain cannot enumerate itself, so without this a
 * settings screen has no way to render "connected".
 *
 * Nothing in this module accepts, returns, or stores key material.
 */

export interface ProviderConnection {
  readonly providerId: string;
  /** Which model source the connection belongs to; `local` today. */
  readonly source: string;
  readonly connectedAt: number;
  readonly updatedAt: number;
}

export interface DefaultModelSelection {
  readonly provider: string;
  readonly model: string;
}

// Relative to the `local` namespace, which supplies the `local.` prefix.
const DEFAULT_MODEL_KEY = "default_model";

interface CustomProviderRow {
  id: string;
  name: string;
  base_url: string;
  api: string;
  models: string;
  context_window: number | null;
  max_tokens: number | null;
  created_at: number;
  updated_at: number;
}

interface ConnectionRow {
  provider_id: string;
  source: string;
  connected_at: number;
  updated_at: number;
}

export class ProviderSettingsStore {
  readonly #db: StudioDatabase;
  /** `app_setting` belongs to the storage domain; this store owns keys in it. */
  readonly #settings: NamespacedSettings;

  constructor(db: StudioDatabase) {
    this.#db = db;
    this.#settings = new AppSettings(db).namespace("local");
  }

  listCustomProviders(): readonly CustomProviderConfig[] {
    const rows = this.#db
      .prepare(
        `SELECT id, name, base_url, api, models, context_window, max_tokens, created_at, updated_at
           FROM custom_provider ORDER BY id`,
      )
      .all() as unknown as CustomProviderRow[];

    return rows.map((row) => this.#toConfig(row));
  }

  getCustomProvider(id: string): CustomProviderConfig | undefined {
    const row = this.#db
      .prepare(
        `SELECT id, name, base_url, api, models, context_window, max_tokens, created_at, updated_at
           FROM custom_provider WHERE id = ?`,
      )
      .get(id) as unknown as CustomProviderRow | undefined;

    return row ? this.#toConfig(row) : undefined;
  }

  /**
   * Writes a provider after full validation, so a row can never describe an
   * endpoint the runtime would refuse to build.
   */
  upsertCustomProvider(input: CustomProviderConfig): CustomProviderConfig {
    const config = normalizeCustomProvider(input);
    const now = Date.now();

    this.#db
      .prepare(
        `INSERT INTO custom_provider
                (id, name, base_url, api, models, context_window, max_tokens, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              base_url = excluded.base_url,
              api = excluded.api,
              models = excluded.models,
              context_window = excluded.context_window,
              max_tokens = excluded.max_tokens,
              updated_at = excluded.updated_at`,
      )
      .run(
        config.id,
        config.name,
        config.baseUrl,
        config.api,
        JSON.stringify(config.models),
        config.contextWindow ?? null,
        config.maxTokens ?? null,
        now,
        now,
      );

    return config;
  }

  removeCustomProvider(id: string): boolean {
    const result = this.#db
      .prepare("DELETE FROM custom_provider WHERE id = ?")
      .run(id);
    return Number(result.changes) > 0;
  }

  listConnections(): readonly ProviderConnection[] {
    const rows = this.#db
      .prepare(
        `SELECT provider_id, source, connected_at, updated_at
           FROM provider_connection ORDER BY provider_id`,
      )
      .all() as unknown as ConnectionRow[];

    return rows.map((row) => ({
      providerId: row.provider_id,
      source: row.source,
      connectedAt: row.connected_at,
      updatedAt: row.updated_at,
    }));
  }

  isConnected(providerId: string): boolean {
    const row = this.#db
      .prepare("SELECT 1 AS present FROM provider_connection WHERE provider_id = ?")
      .get(providerId);
    return row !== undefined;
  }

  /**
   * Records that a provider is connected. Called *after* the credential is
   * stored: this row is a claim about the keychain, and writing it first would
   * make a failed key write look like a successful connection.
   */
  recordConnection(providerId: string, source = "local"): void {
    const now = Date.now();
    this.#db
      .prepare(
        `INSERT INTO provider_connection (provider_id, source, connected_at, updated_at)
              VALUES (?, ?, ?, ?)
         ON CONFLICT(provider_id) DO UPDATE SET
              source = excluded.source,
              updated_at = excluded.updated_at`,
      )
      .run(providerId, source, now, now);
  }

  removeConnection(providerId: string): boolean {
    const result = this.#db
      .prepare("DELETE FROM provider_connection WHERE provider_id = ?")
      .run(providerId);
    return Number(result.changes) > 0;
  }

  getDefaultModel(): DefaultModelSelection | undefined {
    const raw = this.#settings.get(DEFAULT_MODEL_KEY);
    if (raw === undefined) return undefined;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new StorageError("invalid", {
        message: "The stored default model selection is unreadable.",
      });
    }

    const record = parsed as Partial<DefaultModelSelection>;
    if (typeof record.provider !== "string" || typeof record.model !== "string") {
      throw new StorageError("invalid", {
        message: "The stored default model selection is missing a provider or model.",
      });
    }

    return { provider: record.provider, model: record.model };
  }

  setDefaultModel(selection: DefaultModelSelection): void {
    this.#settings.set(DEFAULT_MODEL_KEY, JSON.stringify(selection));
  }

  clearDefaultModel(): void {
    this.#settings.clear(DEFAULT_MODEL_KEY);
  }

  #toConfig(row: CustomProviderRow): CustomProviderConfig {
    let models: readonly string[] = [];
    try {
      const parsed: unknown = JSON.parse(row.models);
      if (Array.isArray(parsed)) {
        models = parsed.filter((entry): entry is string => typeof entry === "string");
      }
    } catch {
      throw new StorageError("invalid", {
        message: `Stored model list for provider "${row.id}" is unreadable.`,
      });
    }

    return {
      id: row.id,
      name: row.name,
      baseUrl: row.base_url,
      api: row.api,
      models,
      contextWindow: row.context_window ?? undefined,
      maxTokens: row.max_tokens ?? undefined,
    };
  }
}
