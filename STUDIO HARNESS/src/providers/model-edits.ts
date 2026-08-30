import * as v from "valibot";

import { providerModelSchema, type ProviderModel } from "../contracts/providers.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import {
  createDomainReporter,
  type ErrorReporter,
} from "../observability/error-reporter.js";
import type { StudioDatabase } from "../storage/database.js";

/**
 * Model editing: manual models, overrides, hiding.
 *
 * Adding a model to an existing provider, correcting one, and hiding one from
 * pickers are one concern, and they own two tables between them: a manual
 * model is a model in its own right, and an override patches something that
 * already exists. The separation inside this file mirrors the separation the
 * contract draws - an override for an unknown id is an error, not an add,
 * because if a rename could also create, a typo in a model id becomes a
 * permanent model with no capabilities rather than an error.
 *
 * This module is the only writer of `provider_model_manual` and
 * `provider_model_override`; the catalog reads manual rows back through here.
 */

export type ModelOverride = {
  readonly displayName: string | undefined;
  readonly hidden: boolean;
};

export type ModelOverridePatch = {
  readonly displayName?: string;
  readonly hidden?: boolean;
};

type ModelOverrideMap = Map<string, Map<string, ModelOverride>>;
type ManualMap = Map<string, Map<string, ProviderModel>>;

export interface ModelEditsOptions {
  readonly db: StudioDatabase;
  readonly reporter?: ErrorReporter | undefined;
}

export class ModelEdits {
  readonly #db: StudioDatabase;
  readonly #reporter: ErrorReporter;

  constructor(options: ModelEditsOptions) {
    this.#db = options.db;
    this.#reporter = options.reporter ?? createDomainReporter("models");
  }

  /** Manual rows keyed by connection then model id, each a full ProviderModel. */
  readManuals(): ManualMap {
    let rows: readonly Record<string, unknown>[];
    try {
      rows = this.#db
        .prepare(
          `SELECT connection_id, model_id, record_json
              FROM provider_model_manual
             ORDER BY connection_id, model_id`,
        )
        .all();
    } catch {
      throw new ProviderConfigurationError("Manual provider models could not be read.");
    }

    const manuals: ManualMap = new Map();
    for (const row of rows) {
      const connectionId = row.connection_id;
      const modelId = row.model_id;
      const raw = row.record_json;
      if (
        typeof connectionId !== "string" ||
        typeof modelId !== "string" ||
        typeof raw !== "string"
      ) {
        this.#reportCorruptModel("unknown", "unknown");
        continue;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        this.#reportCorruptModel(connectionId, modelId);
        continue;
      }
      if (typeof parsed === "object" && parsed !== null && "apiKey" in parsed) {
        this.#reportCorruptModel(connectionId, modelId);
        continue;
      }

      const result = v.safeParse(providerModelSchema, parsed);
      if (
        !result.success ||
        result.output.origin !== "manual" ||
        result.output.connectionId !== connectionId ||
        result.output.modelId !== modelId
      ) {
        this.#reportCorruptModel(connectionId, modelId);
        continue;
      }
      this.#putManual(manuals, result.output);
    }
    return manuals;
  }

  /** The manual model ids per connection, for callers that must not parse records. */
  listManualModelIds(): Map<string, readonly string[]> {
    let rows: readonly Record<string, unknown>[];
    try {
      rows = this.#db
        .prepare(`SELECT connection_id, model_id FROM provider_model_manual ORDER BY model_id`)
        .all();
    } catch {
      return new Map();
    }

    const ids = new Map<string, string[]>();
    for (const row of rows) {
      const connectionId = row.connection_id;
      const modelId = row.model_id;
      if (typeof connectionId !== "string" || typeof modelId !== "string") continue;
      const current = ids.get(connectionId) ?? [];
      current.push(modelId);
      ids.set(connectionId, current);
    }
    return ids;
  }

  readOverrides(): ModelOverrideMap {
    let rows: readonly Record<string, unknown>[];
    try {
      rows = this.#db
        .prepare(
          `SELECT connection_id, model_id, display_name, hidden
              FROM provider_model_override
             ORDER BY connection_id, model_id`,
        )
        .all();
    } catch {
      throw new ProviderConfigurationError("Provider model overrides could not be read.");
    }

    const overrides: ModelOverrideMap = new Map();
    for (const row of rows) {
      const connectionId = row.connection_id;
      const modelId = row.model_id;
      const displayName = row.display_name;
      const hidden = row.hidden;
      if (
        typeof connectionId !== "string" ||
        typeof modelId !== "string" ||
        (displayName !== null && typeof displayName !== "string") ||
        (displayName !== null && displayName.length === 0) ||
        (hidden !== 0 && hidden !== 1)
      ) {
        this.#reportCorruptModel(
          typeof connectionId === "string" ? connectionId : "unknown",
          typeof modelId === "string" ? modelId : "unknown",
        );
        continue;
      }
      this.#putOverride(overrides, connectionId, modelId, {
        displayName: displayName === null ? undefined : displayName,
        hidden: hidden === 1,
      });
    }
    return overrides;
  }

  validateOverridePatch(value: unknown): ModelOverridePatch {
    if (!isRecord(value)) {
      throw new ProviderConfigurationError("Provider model override is not valid.");
    }
    const displayName = value.displayName;
    const hidden = value.hidden;
    if (
      (displayName !== undefined &&
        (typeof displayName !== "string" || displayName.length === 0)) ||
      (hidden !== undefined && typeof hidden !== "boolean")
    ) {
      throw new ProviderConfigurationError("Provider model override is not valid.");
    }
    return {
      ...(displayName === undefined ? {} : { displayName }),
      ...(hidden === undefined ? {} : { hidden }),
    };
  }

  upsertOverride(connectionId: string, modelId: string, patch: ModelOverridePatch): void {
    const current = this.readOverrides().get(connectionId)?.get(modelId);
    const displayName =
      patch.displayName === undefined ? current?.displayName : patch.displayName;
    const hidden = patch.hidden === undefined ? current?.hidden ?? false : patch.hidden;
    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `INSERT INTO provider_model_override
                     (connection_id, model_id, display_name, hidden, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(connection_id, model_id) DO UPDATE SET
                     display_name = excluded.display_name,
                     hidden = excluded.hidden,
                     updated_at = excluded.updated_at`,
          )
          .run(connectionId, modelId, displayName ?? null, hidden ? 1 : 0, Date.now());
      });
    } catch {
      throw new ProviderConfigurationError("Provider model override could not be saved.");
    }
  }

  /**
   * Sets exactly which models a connection offers, in one transaction.
   *
   * The selection the user ticked is stored as the complement it implies: a
   * model the selection omits gains a hidden override, one it includes loses
   * any hidden override it had. The caller supplies the full model universe
   * (the catalog's rows are generated on read and stored nowhere), so "not
   * selected" is decidable here rather than guessed. Rename overrides are
   * untouched - selection is a visibility fact, and folding a rename into it
   * would let a re-tick silently revert a name somebody typed.
   */
  applySelection(
    connectionId: string,
    allModelIds: readonly string[],
    selectedModelIds: readonly string[],
  ): void {
    const selected = new Set(selectedModelIds);
    const overrides = this.readOverrides().get(connectionId) ?? new Map<string, ModelOverride>();

    try {
      this.#db.transaction(() => {
        for (const modelId of allModelIds) {
          const shouldHide = !selected.has(modelId);
          const current = overrides.get(modelId);
          if (shouldHide === (current?.hidden ?? false)) continue;
          this.#db
            .prepare(
              `INSERT INTO provider_model_override
                       (connection_id, model_id, display_name, hidden, updated_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(connection_id, model_id) DO UPDATE SET
                       hidden = excluded.hidden, updated_at = excluded.updated_at`,
            )
            .run(
              connectionId,
              modelId,
              current?.displayName ?? null,
              shouldHide ? 1 : 0,
              Date.now(),
            );
        }
      });
    } catch {
      throw new ProviderConfigurationError("Provider model selection could not be saved.");
    }
  }

  writeManual(model: ProviderModel): void {
    const valid = validateProviderModel(model);
    if (valid.origin !== "manual") {
      throw new ProviderConfigurationError("Only manual models may be stored here.");
    }
    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `INSERT INTO provider_model_manual
                     (connection_id, model_id, record_json, updated_at)
              VALUES (?, ?, ?, ?)
              ON CONFLICT(connection_id, model_id) DO UPDATE SET
                     record_json = excluded.record_json,
                     updated_at = excluded.updated_at`,
          )
          .run(
            valid.connectionId,
            valid.modelId,
            JSON.stringify(valid),
            Date.now(),
          );
      });
    } catch {
      throw new ProviderConfigurationError("Manual provider model could not be saved.");
    }
  }

  deleteManual(connectionId: string, modelId: string): void {
    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `DELETE FROM provider_model_manual
                    WHERE connection_id = ? AND model_id = ?`,
          )
          .run(connectionId, modelId);
        this.#db
          .prepare(
            `DELETE FROM provider_model_override
                    WHERE connection_id = ? AND model_id = ?`,
          )
          .run(connectionId, modelId);
      });
    } catch {
      throw new ProviderConfigurationError("Manual provider model could not be removed.");
    }
  }

  #putManual(map: ManualMap, model: ProviderModel): void {
    const connectionModels = map.get(model.connectionId) ?? new Map<string, ProviderModel>();
    connectionModels.set(model.modelId, model);
    map.set(model.connectionId, connectionModels);
  }

  #putOverride(
    map: ModelOverrideMap,
    connectionId: string,
    modelId: string,
    override: ModelOverride,
  ): void {
    const connectionOverrides = map.get(connectionId) ?? new Map<string, ModelOverride>();
    connectionOverrides.set(modelId, override);
    map.set(connectionId, connectionOverrides);
  }

  #reportCorruptModel(connectionId: string, modelId: string): void {
    this.#reporter.report(
      new ProviderConfigurationError(
        "A stored provider model was invalid and was skipped.",
      ),
      {
        operation: "providers.models.read",
        connection_id: connectionId,
        model_id: modelId,
      },
    );
  }
}

export function validateProviderModel(value: unknown): ProviderModel {
  const result = v.safeParse(providerModelSchema, value);
  if (!result.success) {
    throw new ProviderConfigurationError(
      "Provider model does not match the provider contract.",
    );
  }
  return result.output;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
