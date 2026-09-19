import type { StudioDatabase } from "./database.js";

/**
 * The one owner of `app_setting`.
 *
 * The table is a narrow key/value store for single-valued product state, which
 * makes it the one table every domain is tempted to write directly — and two
 * did: the local BYOK settings store (merged away in migration 16) and
 * `retrieval/settings.ts` each carried their own copy of the same upsert,
 * delete, and read. Two copies of a write is two places for the conflict
 * clause to drift, and no single place to change how settings are stored.
 *
 * Domains own their *keys*, not the table. A domain declares a namespace and
 * gets a view scoped to it; it cannot name another domain's key without
 * declaring that domain's namespace, which is visible in a diff.
 *
 * Values are text. Anything structured is serialized by the caller, because
 * only the caller knows what a valid value looks like and what to do when a
 * stored one no longer parses.
 */

/**
 * The namespaces in use.
 *
 * A closed union rather than an open string: adding a namespace is a decision
 * about who owns what, and it should appear in review rather than arrive as a
 * typo that silently creates a second store.
 *
 * These are the prefixes already present in the database — `local.default_model`
 * and `retrieval.search.primary` were written that way before this class
 * existed. Naming the namespaces to match means no key changes and no
 * migration; choosing tidier names would have orphaned every stored setting on
 * upgrade, which is a silent data loss for a cosmetic gain.
 */
export type SettingNamespace = "local" | "retrieval" | "shell";

export class AppSettings {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /** A view scoped to one namespace. Keys are prefixed and cannot escape it. */
  namespace(namespace: SettingNamespace): NamespacedSettings {
    return new NamespacedSettings(this.#db, namespace);
  }
}

export class NamespacedSettings {
  readonly #db: StudioDatabase;
  readonly #namespace: SettingNamespace;

  constructor(db: StudioDatabase, namespace: SettingNamespace) {
    this.#db = db;
    this.#namespace = namespace;
  }

  #key(key: string): string {
    return `${this.#namespace}.${key}`;
  }

  get(key: string): string | undefined {
    const row = this.#db
      .prepare("SELECT value FROM app_setting WHERE key = ?")
      .get(this.#key(key)) as unknown as { value: string } | undefined;
    return row?.value;
  }

  set(key: string, value: string): void {
    this.#db
      .prepare(
        `INSERT INTO app_setting (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      )
      .run(this.#key(key), value, Date.now());
  }

  clear(key: string): void {
    this.#db.prepare("DELETE FROM app_setting WHERE key = ?").run(this.#key(key));
  }
}
