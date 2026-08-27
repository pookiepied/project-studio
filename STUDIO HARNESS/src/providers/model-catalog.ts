import * as v from "valibot";

import {
  getBuiltinModels,
  getBuiltinProviders,
  type BuiltinProvider,
} from "@earendil-works/pi-ai/providers/all";
import { getSupportedThinkingLevels, type Api, type Model } from "@earendil-works/pi-ai";

import {
  capabilitySlotSchema,
  defaultSelectionSchema,
  providerModelSchema,
  type CapabilitySlot,
  type DefaultSelection,
  type InvocationShape,
  type ModelPricing,
  type ProviderConnection,
  type ProviderKind,
  type ProviderModel,
} from "../contracts/providers.js";
import {
  REASONING_LEVELS,
  type ModelCapability,
  type ReasoningLevel,
  ProviderConfigurationError,
} from "../contracts/models.js";
import {
  createDomainReporter,
  type ErrorReporter,
} from "../observability/error-reporter.js";
import { capabilityFromPiModel } from "../models/local/catalog.js";
import type { LocalRuntime } from "../models/local/runtime.js";
import type { StudioDatabase } from "../storage/database.js";
import { ConnectionStore } from "./connection-store.js";

const modelReferenceSchema = v.object({
  connectionId: v.pipe(v.string(), v.minLength(1)),
  modelId: v.pipe(v.string(), v.minLength(1)),
});

type ModelOverride = {
  readonly displayName: string | undefined;
  readonly hidden: boolean;
};

type ModelOverridePatch = {
  readonly displayName?: string;
  readonly hidden?: boolean;
};

/**
 * Optional halves of the capability and pricing shapes, with `undefined`
 * allowed explicitly so a schema-parsed input (whose optional fields infer as
 * `T | undefined`) is assignable under `exactOptionalPropertyTypes`. An
 * explicit `undefined` still fails the model schema downstream, so it cannot
 * become a stored value.
 */
type PartialCapabilityInput = {
  readonly [K in keyof ModelCapability]?: ModelCapability[K] | undefined;
};

type PartialPricingInput = {
  readonly [K in keyof ModelPricing]?: ModelPricing[K] | undefined;
};

/** A manual model as the caller supplies it; unspecified fields stay unknown. */
export type ManualModelInput = {
  readonly modelId: string;
  readonly displayName: string;
  readonly capability?: PartialCapabilityInput;
  readonly pricing?: PartialPricingInput;
  readonly shape?: InvocationShape;
};

type ModelFilter = {
  readonly connectionId?: string;
  readonly kind?: ProviderKind;
  readonly capability?: CapabilitySlot;
};

type ModelMap = Map<string, Map<string, ProviderModel>>;

export interface ModelCatalogOptions {
  readonly db: StudioDatabase;
  readonly connections: ConnectionStore;
  /** Supplies user-declared local models when a manual model is materialized. */
  readonly runtime?: Pick<LocalRuntime, "listModels">;
  readonly reporter?: ErrorReporter;
}

export class ModelCatalog {
  readonly #db: StudioDatabase;
  readonly #connections: ConnectionStore;
  readonly #runtime: Pick<LocalRuntime, "listModels"> | undefined;
  readonly #reporter: ErrorReporter;

  constructor(options: ModelCatalogOptions) {
    this.#db = options.db;
    this.#connections = options.connections;
    this.#runtime = options.runtime;
    this.#reporter = options.reporter ?? createDomainReporter("models");
  }

  async listModels(filter?: ModelFilter): Promise<readonly ProviderModel[]> {
    const connections = await this.#connections.list();
    const manuals = this.#readManuals();
    const overrides = this.#readOverrides();
    // This is deliberately inside the call. Pi's generated catalog changes with
    // the installed package, so keeping this list across calls would stale it.
    const builtinProviders = getBuiltinProviders();
    const models: ProviderModel[] = [];

    for (const connection of connections) {
      if (
        filter?.connectionId !== undefined &&
        filter.connectionId !== connection.id
      ) {
        continue;
      }
      if (filter?.kind !== undefined && filter.kind !== connection.kind) {
        continue;
      }

      const baseModels = this.#baseModels(
        connection,
        manuals,
        builtinProviders,
      );
      const connectionOverrides = overrides.get(connection.id);

      for (const base of baseModels) {
        const model = this.#applyOverride(
          base,
          connectionOverrides?.get(base.modelId),
        );
        if (
          filter?.capability !== undefined &&
          model.capability[filter.capability] === "unsupported"
        ) {
          continue;
        }
        models.push(model);
      }
    }

    return models;
  }

  /**
   * Patches a model that already exists on the connection.
   *
   * An override for an unknown id is an error, not an add. If a rename could
   * also create, a typo in a model id becomes a permanent model with no
   * capabilities rather than an error — the add gesture is `addManualModel`.
   */
  async setOverride(
    connectionId: string,
    modelId: string,
    patch: ModelOverridePatch,
  ): Promise<ProviderModel> {
    const change = this.#validateOverridePatch(patch);
    const connection = await this.#connections.get(connectionId);
    if (connection === undefined) {
      throw new ProviderConfigurationError(
        `Provider connection "${connectionId}" does not exist.`,
      );
    }

    const base = this.#baseModels(
      connection,
      this.#readManuals(),
      getBuiltinProviders(),
    ).find((model) => model.modelId === modelId);

    if (base === undefined) {
      throw new ProviderConfigurationError(
        `Model "${connectionId}/${modelId}" does not exist on this connection.`,
      );
    }

    this.#upsertOverride(connectionId, modelId, change);

    const result = (await this.listModels({ connectionId })).find(
      (model) => model.modelId === modelId,
    );
    if (result === undefined) {
      throw new ProviderConfigurationError(
        `Model "${connectionId}/${modelId}" could not be read after its override was saved.`,
      );
    }
    return result;
  }

  /**
   * Adds a model the built-in catalog does not know about.
   *
   * Refuses a modelId that already exists on the connection — catalog or
   * manual — so there is no gesture that silently overwrites a live model's
   * capabilities. Unspecified fields stay honestly `unknown` rather than being
   * recorded as `unsupported`, which would advertise a limit nobody confirmed.
   */
  async addManualModel(
    connectionId: string,
    model: ManualModelInput,
  ): Promise<ProviderModel> {
    const connection = await this.#connections.get(connectionId);
    if (connection === undefined) {
      throw new ProviderConfigurationError(
        `Provider connection "${connectionId}" does not exist.`,
      );
    }

    const existing = this.#baseModels(
      connection,
      this.#readManuals(),
      getBuiltinProviders(),
    ).find((entry) => entry.modelId === model.modelId);
    if (existing !== undefined) {
      throw new ProviderConfigurationError(
        `Model "${connectionId}/${model.modelId}" already exists on this connection.`,
      );
    }

    const base = this.#manualModel(connection, model.modelId);
    if (base === undefined) {
      throw new ProviderConfigurationError(
        `Model "${connectionId}/${model.modelId}" cannot be added to this connection.`,
      );
    }

    const created = validateProviderModel({
      ...base,
      displayName: model.displayName,
      capability: { ...unknownCapability(), ...(model.capability ?? {}) },
      pricing: { ...unknownPricing(), ...(model.pricing ?? {}) },
      shape: model.shape ?? "stream",
    });
    this.#writeManual(created);
    return created;
  }

  async removeModel(connectionId: string, modelId: string): Promise<void> {
    const connection = await this.#connections.get(connectionId);
    if (connection === undefined) {
      throw new ProviderConfigurationError(
        `Provider connection "${connectionId}" does not exist.`,
      );
    }

    const base = this.#baseModels(
      connection,
      this.#readManuals(),
      getBuiltinProviders(),
    ).find((model) => model.modelId === modelId);
    if (base === undefined) {
      throw new ProviderConfigurationError(
        `Model "${connectionId}/${modelId}" does not exist.`,
      );
    }

    if (base.origin === "catalog") {
      // A catalog row will be regenerated by Pi on the next read, so removal
      // is a durable hidden override rather than a destructive delete.
      this.#upsertOverride(connectionId, modelId, { hidden: true });
      return;
    }

    // A manual model is the user's row, so deleting it is real deletion. Its
    // separate patch must go too, or a later re-add would inherit old state.
    this.#deleteManual(connectionId, modelId);
  }

  /**
   * The model references the catalog currently serves, as the run names them:
   * `<catalogProvider ?? connectionId>/<modelId>` per row.
   *
   * This is the same derivation the webview's picker applies to decide what a
   * choice is worth, kept beside the catalog so the admission path can check a
   * submission's model against the list the picker was filled from. Hidden
   * rows are included: hiding is a display fact, not an unprovisioning.
   */
  async servedModelReferences(): Promise<ReadonlySet<string>> {
    const [connections, models] = await Promise.all([
      this.#connections.list(),
      this.listModels(),
    ]);
    const vendors = new Map(
      connections.map((connection) => [
        connection.id,
        connection.catalogProvider ?? connection.id,
      ]),
    );
    const served = new Set<string>();
    for (const model of models) {
      const vendor = vendors.get(model.connectionId) ?? model.connectionId;
      served.add(`${vendor}/${model.modelId}`);
    }
    return served;
  }

  async getDefaults(): Promise<DefaultSelection> {    const models = this.#modelIndex(await this.listModels());
    const selections: Record<string, unknown> = {};

    for (const row of this.#defaultRows()) {
      const slotResult = v.safeParse(capabilitySlotSchema, row.slot);
      const connectionId = row.connection_id;
      const modelId = row.model_id;
      if (
        !slotResult.success ||
        typeof connectionId !== "string" ||
        typeof modelId !== "string"
      ) {
        this.#reportCorruptDefault(
          typeof row.slot === "string" ? row.slot : "unknown",
        );
        continue;
      }

      const reference = v.safeParse(modelReferenceSchema, {
        connectionId,
        modelId,
      });
      if (!reference.success) {
        this.#reportCorruptDefault(slotResult.output);
        continue;
      }

      if (getModel(models, connectionId, modelId) === undefined) {
        // Keep the pointer. A temporary catalog or connection disappearance
        // must not silently erase a user's choice.
        this.#reportStaleDefault(slotResult.output, connectionId, modelId);
        continue;
      }

      selections[slotResult.output] = reference.output;
    }

    const result = v.safeParse(defaultSelectionSchema, selections);
    if (!result.success) {
      throw new ProviderConfigurationError(
        "Stored provider defaults do not match the provider contract.",
      );
    }
    return result.output;
  }

  async setDefault(
    slot: CapabilitySlot,
    ref:
      | { readonly connectionId: string; readonly modelId: string }
      | undefined,
  ): Promise<void> {
    const slotResult = v.safeParse(capabilitySlotSchema, slot);
    if (!slotResult.success) {
      throw new ProviderConfigurationError("Provider default slot is not valid.");
    }

    if (ref === undefined) {
      this.#deleteDefault(slotResult.output);
      return;
    }

    const reference = v.safeParse(modelReferenceSchema, ref);
    if (!reference.success) {
      throw new ProviderConfigurationError(
        "Provider default reference is not valid.",
      );
    }

    const models = this.#modelIndex(await this.listModels());
    const model = getModel(
      models,
      reference.output.connectionId,
      reference.output.modelId,
    );
    if (model === undefined) {
      throw new ProviderConfigurationError(
        `Model "${reference.output.connectionId}/${reference.output.modelId}" does not exist.`,
      );
    }
    if (model.capability[slotResult.output] === "unsupported") {
      throw new ProviderConfigurationError(
        `Model "${reference.output.connectionId}/${reference.output.modelId}" does not support the "${slotResult.output}" capability.`,
      );
    }

    this.#upsertDefault(slotResult.output, reference.output);
  }

  #baseModels(
    connection: ProviderConnection,
    manuals: ModelMap,
    builtinProviders: readonly BuiltinProvider[],
  ): readonly ProviderModel[] {
    // There is no media protocol implementation in this task. Returning no
    // media rows is safer than inventing a stream shape for image generation.
    if (connection.kind !== "language") return [];

    const manualModels =
      manuals.get(connection.id) ?? new Map<string, ProviderModel>();
    const models = [...manualModels.values()];

    // No catalogProvider means the user pointed at something the built-in
    // catalog has never heard of — the normal self-hosted case, not an error.
    // Such a connection serves only the models entered by hand.
    const catalogProvider = connection.catalogProvider;
    if (catalogProvider === undefined) return models;

    // The catalog is keyed by the vendor the connection draws from, never by
    // the connection's own id: two OpenAI accounts are two connections with
    // one vendor, and keying on the id would make "work-openai" silently
    // modelless.
    const builtinProvider = builtinProviders.find(
      (provider) => provider === catalogProvider,
    );
    if (builtinProvider === undefined) {
      this.#reporter.report(
        new ProviderConfigurationError(
          `Provider connection "${connection.id}" names catalog provider "${catalogProvider}", which the built-in catalog does not know.`,
        ),
        {
          operation: "providers.models.catalog",
          connection_id: connection.id,
          catalog_provider: catalogProvider,
        },
      );
      return models;
    }

    for (const model of getBuiltinModels(builtinProvider)) {
      if (manualModels.has(model.id)) continue;
      models.push(providerModelFromPi(connection.id, model, "catalog"));
    }
    return models;
  }

  #manualModel(
    connection: ProviderConnection,
    modelId: string,
  ): ProviderModel | undefined {
    if (connection.kind !== "language") return undefined;

    // Same keying as #baseModels: runtime metadata belongs to the vendor, so
    // the lookup goes through catalogProvider and is skipped entirely for a
    // self-hosted connection, whose runtime models are keyed by their own ids.
    const catalogProvider = connection.catalogProvider;
    if (catalogProvider !== undefined) {
      const runtimeModel = this.#runtime
        ?.listModels()
        .find(
          (model) => model.provider === catalogProvider && model.id === modelId,
        );
      if (runtimeModel !== undefined) {
        return providerModelFromPi(connection.id, runtimeModel, "manual");
      }
    }

    return validateProviderModel({
      connectionId: connection.id,
      modelId,
      displayName: modelId,
      capability: unknownCapability(),
      shape: "stream",
      pricing: unknownPricing(),
      hidden: false,
      origin: "manual",
    });
  }

  #applyOverride(
    model: ProviderModel,
    override: ModelOverride | undefined,
  ): ProviderModel {
    return validateProviderModel({
      ...model,
      ...(override?.displayName === undefined
        ? {}
        : { displayName: override.displayName }),
      hidden: override?.hidden ?? false,
    });
  }

  #readManuals(): ModelMap {
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

    const manuals: ModelMap = new Map();
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
      if (isRecord(parsed) && hasOwn(parsed, "apiKey")) {
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
      putModel(manuals, result.output);
    }
    return manuals;
  }

  #readOverrides(): Map<string, Map<string, ModelOverride>> {
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

    const overrides = new Map<string, Map<string, ModelOverride>>();
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
      putOverride(overrides, connectionId, modelId, {
        displayName: displayName === null ? undefined : displayName,
        hidden: hidden === 1,
      });
    }
    return overrides;
  }

  #defaultRows(): readonly Record<string, unknown>[] {
    try {
      return this.#db
        .prepare(
          `SELECT slot, connection_id, model_id
             FROM provider_default
            ORDER BY slot`,
        )
        .all();
    } catch {
      throw new ProviderConfigurationError("Provider defaults could not be read.");
    }
  }

  #modelIndex(models: readonly ProviderModel[]): ModelMap {
    const index: ModelMap = new Map();
    for (const model of models) putModel(index, model);
    return index;
  }

  #validateOverridePatch(value: unknown): ModelOverridePatch {
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

  #upsertOverride(
    connectionId: string,
    modelId: string,
    patch: ModelOverridePatch,
  ): void {
    const current = this.#readOverrides().get(connectionId)?.get(modelId);
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

  #writeManual(model: ProviderModel): void {
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

  #deleteManual(connectionId: string, modelId: string): void {
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

  #upsertDefault(
    slot: CapabilitySlot,
    reference: { readonly connectionId: string; readonly modelId: string },
  ): void {
    try {
      this.#db.transaction(() => {
        this.#db
          .prepare(
            `INSERT INTO provider_default
                    (slot, connection_id, model_id, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(slot) DO UPDATE SET
                    connection_id = excluded.connection_id,
                    model_id = excluded.model_id,
                    updated_at = excluded.updated_at`,
          )
          .run(slot, reference.connectionId, reference.modelId, Date.now());
      });
    } catch {
      throw new ProviderConfigurationError("Provider default could not be saved.");
    }
  }

  #deleteDefault(slot: CapabilitySlot): void {
    try {
      this.#db.transaction(() => {
        this.#db.prepare("DELETE FROM provider_default WHERE slot = ?").run(slot);
      });
    } catch {
      throw new ProviderConfigurationError("Provider default could not be removed.");
    }
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

  #reportCorruptDefault(slot: string): void {
    this.#reporter.report(
      new ProviderConfigurationError(
        "A stored provider default was invalid and was skipped.",
      ),
      { operation: "providers.defaults.read", slot },
    );
  }

  #reportStaleDefault(
    slot: CapabilitySlot,
    connectionId: string,
    modelId: string,
  ): void {
    this.#reporter.report(
      new ProviderConfigurationError(
        "A stored provider default points to a model that is currently absent.",
      ),
      {
        operation: "providers.defaults.read",
        slot,
        connection_id: connectionId,
        model_id: modelId,
      },
    );
  }
}

export const ProviderModelCatalog = ModelCatalog;

function providerModelFromPi(
  connectionId: string,
  model: Model<Api>,
  origin: "catalog" | "manual",
): ProviderModel {
  return validateProviderModel({
    connectionId,
    modelId: model.id,
    displayName: model.name.length > 0 ? model.name : model.id,
    capability: capabilityFromPiModel(model),
    reasoningLevels: reasoningLevelsFromPiModel(model),
    shape: "stream",
    pricing: pricingFromPiModel(model),
    hidden: false,
    origin,
  });
}

/**
 * The reasoning levels one Pi model actually supports.
 *
 * Pi answers this itself (`getSupportedThinkingLevels`): "off" for a model
 * that cannot reason, and otherwise every level except one the model's own
 * `thinkingLevelMap` marks null - with `xhigh` and `max` present only where
 * the map names them. "off" is dropped here rather than offered: the composer
 * adds its own "default" choice, and a control offering both Default and Off
 * would be two words for the same absence of a request.
 */
function reasoningLevelsFromPiModel(model: Model<Api>): readonly ReasoningLevel[] {
  const known = new Set<string>(REASONING_LEVELS);
  return getSupportedThinkingLevels(model).filter(
    (level): level is ReasoningLevel => level !== "off" && known.has(level),
  );
}

function pricingFromPiModel(model: Model<Api>): ModelPricing {
  const cost: unknown = model.cost;
  const record = isRecord(cost) ? cost : undefined;
  return {
    input: price(record?.input),
    output: price(record?.output),
    cacheRead: price(record?.cacheRead),
    cacheWrite: price(record?.cacheWrite),
  };
}

function price(value: unknown): number | "unknown" {
  return typeof value === "number" && Number.isFinite(value) ? value : "unknown";
}

function unknownPricing(): ModelPricing {
  return {
    input: "unknown",
    output: "unknown",
    cacheRead: "unknown",
    cacheWrite: "unknown",
  };
}

function unknownCapability(): ModelCapability {
  return {
    textGeneration: "unknown",
    streaming: "unknown",
    reasoning: "unknown",
    toolCalling: "unknown",
    vision: "unknown",
    embeddings: "unknown",
    reranking: "unknown",
    imageGeneration: "unknown",
    videoGeneration: "unknown",
    speechGeneration: "unknown",
    transcription: "unknown",
    contextWindow: "unknown",
    maxOutputTokens: "unknown",
  };
}

function validateProviderModel(value: unknown): ProviderModel {
  const result = v.safeParse(providerModelSchema, value);
  if (!result.success) {
    throw new ProviderConfigurationError(
      "Provider model does not match the provider contract.",
    );
  }
  return result.output;
}

function putModel(map: ModelMap, model: ProviderModel): void {
  const connectionModels = map.get(model.connectionId) ?? new Map();
  connectionModels.set(model.modelId, model);
  map.set(model.connectionId, connectionModels);
}

function putOverride(
  map: Map<string, Map<string, ModelOverride>>,
  connectionId: string,
  modelId: string,
  override: ModelOverride,
): void {
  const connectionOverrides = map.get(connectionId) ?? new Map();
  connectionOverrides.set(modelId, override);
  map.set(connectionId, connectionOverrides);
}

function getModel(
  map: ModelMap,
  connectionId: string,
  modelId: string,
): ProviderModel | undefined {
  return map.get(connectionId)?.get(modelId);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, property: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, property);
}
