import * as v from "valibot";

import {
  providerConnectionSchema,
  type CredentialStatus,
  type ProviderConnection,
  type ProviderConnectionDraft,
  type ProviderConnectionPatch,
} from "../contracts/providers.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import {
  assertValidKey,
  type CredentialKey,
  type SecureCredentialStore,
} from "../credentials/credential-store.js";
import {
  createDomainReporter,
  type ErrorReporter,
} from "../observability/error-reporter.js";
import { customProviderEnvVar } from "../models/local/runtime.js";
import type { StudioDatabase } from "../storage/database.js";

/**
 * Created by migration 8, not here.
 *
 * A table made on the fly in a constructor is a table `assertNoSecretColumns`
 * never sees and `PRAGMA user_version` never accounts for -- the schema guard
 * runs inside `migrate()` alone. Owning the DDL here would have put this table
 * outside both.
 */
const TABLE_NAME = "provider_connection_record";

export interface ConnectionStoreOptions {
  readonly db: StudioDatabase;
  readonly credentials: SecureCredentialStore;
  readonly reporter?: ErrorReporter;
}

export class ConnectionStore {
  readonly #db: StudioDatabase;
  readonly #credentials: SecureCredentialStore;
  readonly #reporter: ErrorReporter;
  readonly #queues = new Map<string, Promise<unknown>>();

  constructor(options: ConnectionStoreOptions) {
    this.#db = options.db;
    this.#credentials = options.credentials;
    this.#reporter = options.reporter ?? createDomainReporter("models");
  }

  async list(): Promise<readonly ProviderConnection[]> {
    const rows = this.#rows();
    const connections: ProviderConnection[] = [];

    for (const row of rows) {
      const id = row.id;
      const raw = row.record_json;
      if (typeof id !== "string" || typeof raw !== "string") {
        this.#reportCorrupt(typeof id === "string" ? id : "unknown");
        continue;
      }

      const connection = await this.#readRecord(id, raw);
      if (connection !== undefined) connections.push(connection);
    }

    return connections;
  }

  async get(id: string): Promise<ProviderConnection | undefined> {
    const row = this.#row(id);
    if (row === undefined) return undefined;

    const raw = row.record_json;
    if (typeof raw !== "string") {
      this.#reportCorrupt(id);
      return undefined;
    }

    return this.#readRecord(id, raw);
  }

  async add(draft: ProviderConnectionDraft): Promise<ProviderConnection> {
    this.#validateApiKey(draft.apiKey);
    const preliminary = this.#validate(this.#draftRecord(draft, "absent"));
    const key = this.#credentialKey(preliminary.id);

    return this.#serialize(preliminary.id, async () => {
      if (this.#hasRow(preliminary.id)) {
        throw new ProviderConfigurationError(
          `Provider connection "${preliminary.id}" already exists.`,
        );
      }

      if (draft.apiKey !== undefined) {
        await this.#setCredential(key, draft.apiKey);
      }

      try {
        const connection = this.#validate(
          this.#draftRecord(draft, await this.#credentialStatus(preliminary.id)),
        );
        this.#insert(preliminary.id, this.#storedJson(connection));
        return connection;
      } catch (error) {
        if (draft.apiKey !== undefined) {
          await this.#deleteCredential(key);
        }
        throw error;
      }
    });
  }

  async update(
    id: string,
    patch: ProviderConnectionPatch,
  ): Promise<ProviderConnection> {
    if (!isRecord(patch) || hasOwn(patch, "id") || hasOwn(patch, "kind")) {
      throw new ProviderConfigurationError(
        "A provider connection update cannot change its id or kind.",
      );
    }
    this.#validateApiKey(patch.apiKey);
    const key = this.#credentialKey(id);

    return this.#serialize(id, async () => {
      const current = await this.#readStored(id);
      if (current === undefined) {
        throw new ProviderConfigurationError(
          `Provider connection "${id}" does not exist.`,
        );
      }

      // Validate the non-secret patch before touching the credential store. A
      // protocol from another kind must fail without partially updating a key.
      this.#validate(this.#merge(current, patch, "absent"));

      if (patch.apiKey !== undefined) {
        await this.#setCredential(key, patch.apiKey);
      }

      const connection = this.#validate(
        this.#merge(current, patch, await this.#credentialStatus(id)),
      );
      this.#replace(id, this.#storedJson(connection));
      return connection;
    });
  }

  async remove(id: string): Promise<void> {
    const key = this.#credentialKey(id);

    await this.#serialize(id, async () => {
      // The key goes first so a database failure cannot leave an orphaned
      // secret. Deleting a missing credential is intentionally idempotent.
      await this.#deleteCredential(key);
      this.#deleteRow(id);
    });
  }


  #rows() {
    try {
      return this.#db
        .prepare(
          `SELECT id, record_json FROM ${TABLE_NAME} ORDER BY id`,
        )
        .all();
    } catch {
      throw new ProviderConfigurationError(
        "Provider connections could not be read.",
      );
    }
  }

  #row(id: string) {
    try {
      return this.#db
        .prepare(`SELECT record_json FROM ${TABLE_NAME} WHERE id = ?`)
        .get(id);
    } catch {
      throw new ProviderConfigurationError(
        "Provider connections could not be read.",
      );
    }
  }

  async #readStored(id: string): Promise<ProviderConnection | undefined> {
    const row = this.#row(id);
    if (row === undefined) return undefined;

    const raw = row.record_json;
    if (typeof raw !== "string") {
      this.#reportCorrupt(id);
      return undefined;
    }

    return this.#readRecord(id, raw);
  }

  async #readRecord(
    rowId: string,
    raw: string,
  ): Promise<ProviderConnection | undefined> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.#reportCorrupt(rowId);
      return undefined;
    }

    if (!isRecord(parsed) || hasOwn(parsed, "apiKey") || hasOwn(parsed, "credential")) {
      this.#reportCorrupt(rowId);
      return undefined;
    }

    const preliminary = this.#tryParse(parsed, "absent");
    if (preliminary === undefined || preliminary.id !== rowId) {
      this.#reportCorrupt(rowId);
      return undefined;
    }

    let status: CredentialStatus;
    try {
      status = await this.#credentialStatus(preliminary.id);
    } catch {
      this.#reportCorrupt(rowId);
      return undefined;
    }

    const connection = this.#tryParse(parsed, status);
    if (connection === undefined || connection.id !== rowId) {
      this.#reportCorrupt(rowId);
      return undefined;
    }

    return connection;
  }

  #validate(value: unknown): ProviderConnection {
    const result = v.safeParse(providerConnectionSchema, value);
    if (!result.success) {
      throw new ProviderConfigurationError(
        "Provider connection does not match the provider contract.",
      );
    }
    return result.output;
  }

  #tryParse(
    value: Record<string, unknown>,
    status: CredentialStatus,
  ): ProviderConnection | undefined {
    const result = v.safeParse(providerConnectionSchema, {
      ...value,
      credential: status,
    });
    return result.success ? result.output : undefined;
  }

  #draftRecord(
    draft: ProviderConnectionDraft,
    status: CredentialStatus,
  ): unknown {
    const baseUrl = draft.baseUrl;
    return {
      id: draft.id,
      displayName: draft.displayName,
      kind: draft.kind,
      source: draft.source,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(draft.catalogProvider === undefined
        ? {}
        : { catalogProvider: draft.catalogProvider }),
      enabled: draft.enabled,
      credential: status,
      protocol: draft.protocol,
    };
  }

  #merge(
    current: ProviderConnection,
    patch: ProviderConnectionPatch,
    status: CredentialStatus,
  ): unknown {
    const displayName =
      patch.displayName === undefined ? current.displayName : patch.displayName;
    const baseUrl = patch.baseUrl === undefined ? current.baseUrl : patch.baseUrl;
    const enabled = patch.enabled === undefined ? current.enabled : patch.enabled;
    const protocol = patch.protocol === undefined ? current.protocol : patch.protocol;

    return {
      id: current.id,
      displayName,
      kind: current.kind,
      source: current.source,
      ...(baseUrl === undefined ? {} : { baseUrl }),
      ...(current.catalogProvider === undefined
        ? {}
        : { catalogProvider: current.catalogProvider }),
      enabled,
      credential: status,
      protocol,
    };
  }

  #storedJson(connection: ProviderConnection): string {
    const { credential: _credential, ...record } = connection;
    return JSON.stringify(record);
  }

  #hasRow(id: string): boolean {
    return this.#row(id) !== undefined;
  }

  #insert(id: string, recordJson: string): void {
    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `INSERT INTO ${TABLE_NAME} (id, record_json, updated_at)
             VALUES (?, ?, ?)`,
          )
          .run(id, recordJson, Date.now());
      });
    } catch {
      if (this.#hasRow(id)) {
        throw new ProviderConfigurationError(
          `Provider connection "${id}" already exists.`,
        );
      }
      throw new ProviderConfigurationError(
        "Provider connection could not be saved.",
      );
    }
  }

  #replace(id: string, recordJson: string): void {
    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `UPDATE ${TABLE_NAME}
                SET record_json = ?, updated_at = ?
              WHERE id = ?`,
          )
          .run(recordJson, Date.now(), id);
      });
    } catch {
      throw new ProviderConfigurationError(
        "Provider connection could not be saved.",
      );
    }
  }

  #deleteRow(id: string): void {
    try {
      this.#db.transaction(() => {
        this.#db.prepare(`DELETE FROM ${TABLE_NAME} WHERE id = ?`).run(id);
      });
    } catch {
      throw new ProviderConfigurationError(
        "Provider connection could not be removed.",
      );
    }
  }

  #credentialKey(id: string): CredentialKey {
    try {
      return assertValidKey({ scope: "provider", id });
    } catch {
      throw new ProviderConfigurationError(
        "Provider connection id is not valid for credential storage.",
      );
    }
  }

  async #credentialStatus(id: string): Promise<CredentialStatus> {
    const key = this.#credentialKey(id);
    let stored: string | null;
    try {
      stored = await this.#credentials.get(key);
    } catch {
      throw new ProviderConfigurationError(
        "Provider credential status could not be read.",
      );
    }

    if (stored !== null) return "set";

    const envValue = process.env[customProviderEnvVar(id)];
    return envValue !== undefined && envValue.trim() !== ""
      ? "from-env"
      : "absent";
  }

  async #setCredential(key: CredentialKey, secret: string): Promise<void> {
    try {
      // The secret is passed directly to the secure store and never enters the
      // non-secret object assembled by this class.
      await this.#credentials.set(key, secret);
    } catch {
      throw new ProviderConfigurationError(
        "Provider credential could not be stored securely.",
      );
    }
  }

  async #deleteCredential(key: CredentialKey): Promise<void> {
    try {
      await this.#credentials.delete(key);
    } catch {
      throw new ProviderConfigurationError(
        "Provider credential could not be removed.",
      );
    }
  }

  #validateApiKey(value: string | undefined): void {
    if (value !== undefined && typeof value !== "string") {
      throw new ProviderConfigurationError("Provider apiKey must be a string.");
    }
  }

  #reportCorrupt(id: string): void {
    this.#reporter.report(
      new ProviderConfigurationError(
        "A stored provider connection was invalid and was skipped.",
      ),
      {
        operation: "providers.connections.read",
        provider_id: id,
      },
    );
  }

  #serialize<T>(id: string, work: () => Promise<T>): Promise<T> {
    const previous = this.#queues.get(id) ?? Promise.resolve();
    const next = previous.then(work, work);
    this.#queues.set(id, next.catch(() => undefined));
    return next;
  }
}

export const ProviderConnectionStore = ConnectionStore;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}
