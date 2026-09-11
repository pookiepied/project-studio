import * as v from "valibot";

import {
  capabilitySlotSchema,
  defaultSelectionSchema,
  type CapabilitySlot,
  type DefaultSelection,
  type InvocationShape,
  type ModelPricing,
  type ProviderConnection,
  type ProviderKind,
  type ProviderModel,
  servesKind,
} from "../../contracts/providers.js";
import {
  type ModelCapability,
  type ReasoningLevel,
  ProviderConfigurationError,
} from "../../contracts/models.js";
import {
  createDomainReporter,
  type ErrorReporter,
} from "../../observability/error-reporter.js";
import { supportedCustomApis } from "../language/local/apis.js";
import type { StudioDatabase } from "../../storage/database.js";
import { ConnectionStore } from "./connection-store.js";
import { catalogModelsFor, type CatalogSourceModel } from "../catalog/index.js";
import {
  ModelEdits,
  validateProviderModel,
  type ModelOverride,
} from "./model-edits.js";
import { ProbeStateStore } from "./probe-state.js";

const modelReferenceSchema = v.object({
  connectionId: v.pipe(v.string(), v.minLength(1)),
  modelId: v.pipe(v.string(), v.minLength(1)),
});

type ModelMap = Map<string, Map<string, ProviderModel>>;

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

/**
 * A manual model as the caller supplies it; unspecified fields stay unknown.
 *
 * `capability` is where the caller declares what the model can do against the
 * contract's real fields, and `reasoningLevels` is that model's own levels -
 * the same vocabulary the catalog serves for built-in models, empty for a
 * model that cannot reason. What the caller states here is what pickers,
 * defaults, and the run then do or refuse.
 */
export type ManualModelInput = {
  readonly modelId: string;
  readonly displayName: string;
  readonly capability?: PartialCapabilityInput;
  readonly reasoningLevels?: readonly ReasoningLevel[];
  readonly pricing?: PartialPricingInput;
  readonly shape?: InvocationShape;
};

type ModelFilter = {
  readonly connectionId?: string;
  readonly kind?: ProviderKind;
  readonly capability?: CapabilitySlot;
};

export interface ModelCatalogOptions {
  readonly db: StudioDatabase;
  readonly connections: ConnectionStore;
  readonly reporter?: ErrorReporter;
}

export class ModelCatalog {
  readonly #db: StudioDatabase;
  readonly #connections: ConnectionStore;
  readonly #edits: ModelEdits;
  readonly #probeState: ProbeStateStore;
  readonly #reporter: ErrorReporter;

  constructor(options: ModelCatalogOptions) {
    this.#db = options.db;
    this.#connections = options.connections;
    this.#edits = new ModelEdits({ db: options.db, reporter: options.reporter });
    this.#probeState = new ProbeStateStore({ db: options.db });
    this.#reporter = options.reporter ?? createDomainReporter("models");
  }

  async listModels(filter?: ModelFilter): Promise<readonly ProviderModel[]> {
    const connections = await this.#connections.list();
    const manuals = this.#edits.readManuals();
    const overrides = this.#edits.readOverrides();
    // Learned once per call: the probe state changes only when a probe runs,
    // but reading it here keeps this method the one honest view of the shelf.
    const probeStates = this.#probeState.readAll();
    const models: ProviderModel[] = [];

    for (const connection of connections) {
      if (
        filter?.connectionId !== undefined &&
        filter.connectionId !== connection.id
      ) {
        continue;
      }
      if (filter?.kind !== undefined && !servesKind(connection, filter.kind)) {
        continue;
      }

      const baseModels = await this.#baseModels(connection, manuals);
      const connectionOverrides = overrides.get(connection.id);
      // Availability is a fact about the provider's own list, which describes
      // language models; media ids are not enumerable through the same
      // endpoint, so media rows are never marked from it.
      const served =
        connection.serves.language !== undefined ? probeStates.get(connection.id) : undefined;

      for (const base of baseModels) {
        const model = this.#applyOverride(
          base,
          connectionOverrides?.get(base.modelId),
          served,
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
    patch: { readonly displayName?: string; readonly hidden?: boolean },
  ): Promise<ProviderModel> {
    const change = this.#edits.validateOverridePatch(patch);
    const connection = await this.#connections.get(connectionId);
    if (connection === undefined) {
      throw new ProviderConfigurationError(
        `Provider connection "${connectionId}" does not exist.`,
      );
    }

    const base = (await this.#baseModels(connection, this.#edits.readManuals())).find(
      (model) => model.modelId === modelId,
    );

    if (base === undefined) {
      throw new ProviderConfigurationError(
        `Model "${connectionId}/${modelId}" does not exist on this connection.`,
      );
    }

    this.#edits.upsertOverride(connectionId, modelId, change);

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
   * Sets exactly which models this connection offers, from a full selection.
   *
   * The caller saw the whole shelf and ticked a subset; the difference is
   * stored as hiding, the same fact the per-model gesture writes, so the two
   * can never disagree about what "offered" means.
   */
  async setModelSelection(
    connectionId: string,
    selectedModelIds: readonly string[],
  ): Promise<void> {
    const connection = await this.#connections.get(connectionId);
    if (connection === undefined) {
      throw new ProviderConfigurationError(
        `Provider connection "${connectionId}" does not exist.`,
      );
    }
    const all = await this.listModels({ connectionId });
    this.#edits.applySelection(
      connectionId,
      all.map((model) => model.modelId),
      selectedModelIds,
    );
  }

  /**
   * Adds a model the built-in catalogs do not know about.
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

    const existing = (await this.#baseModels(connection, this.#edits.readManuals())).find(
      (entry) => entry.modelId === model.modelId,
    );
    if (existing !== undefined) {
      throw new ProviderConfigurationError(
        `Model "${connectionId}/${model.modelId}" already exists on this connection.`,
      );
    }

    const created = validateProviderModel({
      connectionId,
      modelId: model.modelId,
      displayName: model.displayName,
      capability: { ...unknownCapability(), ...(model.capability ?? {}) },
      reasoningLevels: model.reasoningLevels ?? [],
      pricing: { ...unknownPricing(), ...(model.pricing ?? {}) },
      shape: model.shape ?? "stream",
      hidden: false,
      origin: "manual",
    });
    this.#edits.writeManual(created);
    return created;
  }

  async removeModel(connectionId: string, modelId: string): Promise<void> {
    const connection = await this.#connections.get(connectionId);
    if (connection === undefined) {
      throw new ProviderConfigurationError(
        `Provider connection "${connectionId}" does not exist.`,
      );
    }

    const base = (await this.#baseModels(connection, this.#edits.readManuals())).find(
      (model) => model.modelId === modelId,
    );
    if (base === undefined) {
      throw new ProviderConfigurationError(
        `Model "${connectionId}/${modelId}" does not exist.`,
      );
    }

    if (base.origin === "catalog") {
      // A catalog row will be regenerated from its source catalog on the next
      // read, so removal is a durable hidden override rather than a delete.
      this.#edits.upsertOverride(connectionId, modelId, { hidden: true });
      return;
    }

    // A manual model is the user's row, so deleting it is real deletion. Its
    // separate patch must go too, or a later re-add would inherit old state.
    this.#edits.deleteManual(connectionId, modelId);
  }

  /**
   * Records what one probe learned about what the provider serves.
   *
   * The catalog marks models the provider's own list omits - the Part 6
   * answer: the connection is taught what it can actually serve, and only
   * those rows are selectable. See `probe-state.ts` for why the mark is
   * advisory, per connection, and language-only.
   */
  recordServedModels(connectionId: string, servedIds: readonly string[]): void {
    this.#probeState.record(connectionId, servedIds, Date.now());
  }

  /**
   * The model references the catalog currently serves, as the run names them:
   * `<catalogProvider ?? connectionId>/<modelId>` per row.
   *
   * This is the same derivation the webview's picker applies to decide what a
   * choice is worth, kept beside the catalog so the admission path can check a
   * submission's model against the list the picker was filled from. Hidden
   * rows are included: hiding is a display fact, not an unprovisioning.
   *
   * A row is only served when the runtime can actually resolve it: chat
   * models from Pi's own catalog (or declared beside them with the
   * capability named), manual models under a catalog-backed connection
   * (Pi's collection or the runtime's registered extras), and manual models
   * on a self-hosted connection whose protocol is one the runtime loads.
   * Declared speech, image, and retrieval models have no invocation path
   * through the chat runtime and are named by no reference here.
   */
  async servedModelReferences(): Promise<ReadonlySet<string>> {
    const [connections, models] = await Promise.all([
      this.#connections.list(),
      this.listModels(),
    ]);
    const byId = new Map(connections.map((connection) => [connection.id, connection]));
    const loadable = new Set(supportedCustomApis());

    const served = new Set<string>();
    for (const model of models) {
      const connection = byId.get(model.connectionId);
      if (connection === undefined) continue;
      const protocol = connection.serves.language;
      if (protocol === undefined || !connection.enabled) continue;

      if (model.origin === "catalog") {
        if (model.capability.textGeneration !== "supported") continue;
      } else if (model.origin === "manual") {
        const runtimeHasIt =
          connection.catalogProvider !== undefined ||
          loadable.has(protocol);
        if (!runtimeHasIt) continue;
      } else {
        continue;
      }

      const vendor = connection.catalogProvider ?? connection.id;
      served.add(`${vendor}/${model.modelId}`);
    }
    return served;
  }

  async getDefaults(): Promise<DefaultSelection> {
    const models = this.#modelIndex(await this.listModels());
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
    if (model.available === false) {
      throw new ProviderConfigurationError(
        `Model "${reference.output.connectionId}/${reference.output.modelId}" is not offered by its provider right now, so it cannot fill the "${slotResult.output}" slot.`,
      );
    }

    this.#upsertDefault(slotResult.output, reference.output);
  }

  async #baseModels(
    connection: ProviderConnection,
    manuals: ModelMap,
  ): Promise<readonly ProviderModel[]> {
    const manualModels =
      manuals.get(connection.id) ?? new Map<string, ProviderModel>();
    const models = [...manualModels.values()];

    // No catalogProvider means the user pointed at something the built-in
    // catalogs have never heard of — the normal self-hosted case, not an
    // error. Such a connection serves only the models entered by hand.
    const sources = await catalogModelsFor(connection);
    const seen = new Set(models.map((model) => model.modelId));
    for (const source of sources) {
      if (seen.has(source.modelId)) continue;
      seen.add(source.modelId);
      models.push(providerModelFromSource(connection.id, source));
    }
    return models;
  }

  #applyOverride(
    model: ProviderModel,
    override: ModelOverride | undefined,
    served: { readonly servedIds: ReadonlySet<string> } | undefined,
  ): ProviderModel {
    // The provider's own word outranks the catalog's: a row its list omits is
    // marked unavailable but never deleted, because the mark is one probe old
    // and the next probe may disagree.
    const available =
      served === undefined ||
      model.origin !== "catalog" ||
      served.servedIds.has(model.modelId);
    return validateProviderModel({
      ...model,
      ...(override?.displayName === undefined ? {} : { displayName: override.displayName }),
      hidden: override?.hidden ?? false,
      available,
    });
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

  /**
   * The stored textGeneration default as the runtime reads it, without
   * touching the credential store and without validating the reference.
   *
   * This is the sync counterpart of `getDefaults` for the runtime derivation:
   * a harness starting a turn needs to know what the stable alias points at
   * before any keychain is available. The pointer is returned even when the
   * model is currently absent - the same tolerance `getDefaults` has.
   */
  readDefaultRow(): { readonly connectionId: string; readonly modelId: string } | undefined {
    return readDefaultSelectionRow(this.#db);
  }

  #modelIndex(models: readonly ProviderModel[]): ModelMap {
    const index: ModelMap = new Map();
    for (const model of models) putModel(index, model);
    return index;
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
}

export const ProviderModelCatalog = ModelCatalog;

/**
 * The stored textGeneration default, read straight from the table this module
 * owns. Exported for the runtime derivation, which must not construct a whole
 * catalog (nor resolve credentials) to learn what the alias points at.
 */
export function readDefaultSelectionRow(
  db: StudioDatabase,
): { readonly connectionId: string; readonly modelId: string } | undefined {
  let rows: readonly Record<string, unknown>[];
  try {
    rows = db
      .prepare(`SELECT slot, connection_id, model_id FROM provider_default ORDER BY slot`)
      .all();
  } catch {
    return undefined;
  }
  for (const row of rows) {
    if (row.slot !== "textGeneration") continue;
    const connectionId = row.connection_id;
    const modelId = row.model_id;
    if (typeof connectionId !== "string" || typeof modelId !== "string") return undefined;
    return { connectionId, modelId };
  }
  return undefined;
}

function providerModelFromSource(
  connectionId: string,
  source: CatalogSourceModel,
): ProviderModel {
  return validateProviderModel({
    connectionId,
    modelId: source.modelId,
    displayName: source.displayName,
    capability: source.capability,
    reasoningLevels: source.reasoningLevels,
    shape: source.shape,
    pricing: source.pricing,
    hidden: false,
    origin: "catalog",
  });
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
    imageEditing: "unknown",
    videoGeneration: "unknown",
    speechGeneration: "unknown",
    transcription: "unknown",
    webSearch: "unknown",
    webFetch: "unknown",
    contextWindow: "unknown",
    maxOutputTokens: "unknown",
  };
}

function putModel(map: ModelMap, model: ProviderModel): void {
  // Typed: an untyped `new Map()` is `Map<any, any>`, and that `any` leaves
  // through this function into everything the catalog hands out.
  const connectionModels = map.get(model.connectionId) ?? new Map<string, ProviderModel>();
  connectionModels.set(model.modelId, model);
  map.set(model.connectionId, connectionModels);
}

function getModel(
  map: ModelMap,
  connectionId: string,
  modelId: string,
): ProviderModel | undefined {
  return map.get(connectionId)?.get(modelId);
}
