import {
  DEFAULT_MODEL_NAME,
  DEFAULT_MODEL_PROVIDER,
  defaultModelReference,
  ProviderConfigurationError,
  type ModelDescriptor,
  type ModelProviderAdapter,
  type ModelSource,
  type ReasoningLevel,
} from "../../contracts/models.js";
import type { ProviderConfig } from "./provider-config.js";
import { ModelRegistry } from "./model-registry.js";
import { TestModelProviderAdapter } from "./adapters/test-adapter.js";
import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import { KeyringCredentialStore } from "../../credentials/keyring-store.js";
import { LocalModelProviderAdapter } from "./adapters/local-adapter.js";
import type { StudioDatabase } from "../../storage/database.js";
import { AppSettings } from "../../storage/app-settings.js";
import {
  defaultSelectionFromEnvironment,
  mergeCustomProviders,
  tolerantLocalModelConfig,
  type CustomProviderConfig,
  type ExtraProviderModelGroup,
  type LocalModelConfig,
} from "./local/config.js";
import { PiCredentialStore } from "./local/credential-bridge.js";
import { createLocalRuntime } from "./local/runtime.js";
import { readStoredConnections } from "../connections/connection-store.js";
import { catalogBaseUrlFor } from "../connections/connection-probe.js";
import { languageCatalogModels } from "./pi-catalog.js";
import { ModelEdits } from "../connections/model-edits.js";
import type { ProviderModel } from "../../contracts/providers.js";
import { readDefaultSelectionRow } from "../connections/model-catalog.js";
import { supportedCustomApis } from "./local/apis.js";
import { connectionCredentialKey } from "../connections/connection-credentials.js";
import { observationFailure, observeOperation } from "../../observability/operation.js";
import { recordObservation } from "../../observability/recorder.js";

interface LocalBootstrapOverrides {
  readonly config?: LocalModelConfig;
  readonly credentials?: SecureCredentialStore;
}

export interface BootstrapOptions {
  readonly local?: LocalBootstrapOverrides;
  /** The database provider settings are read from. ... (ADR 0035 §3). */
  readonly database?: StudioDatabase;
}

export function createModelProviderAdapter(
  source: ModelSource,
  options: BootstrapOptions = {},
): ModelProviderAdapter {
  switch (source) {
    case "test":
      return new TestModelProviderAdapter();
    case "local":
      return createLocalAdapter(options.local ?? {}, options.database);
    default:
      throw new ProviderConfigurationError(
        `Unknown model source "${String(source)}".`,
      );
  }
}

/**
 * How a settings-backed local adapter is rebuilt after provider settings
 * change. Present only for an adapter whose configuration came from the
 * database: a fixed `config` override has nothing newer to read.
 */
const localReloaders = new WeakMap<LocalModelProviderAdapter, () => void>();

function createLocalAdapter(
  overrides: LocalBootstrapOverrides,
  database: StudioDatabase | undefined,
): LocalModelProviderAdapter {
  let config = overrides.config;
  if (config === undefined) {
    if (database === undefined) {
      throw new ProviderConfigurationError(
        "Local model settings cannot be read without a database.",
      );
    }
    config = resolveLocalModelConfigFromSettings(database);
  }
  const credentials = overrides.credentials ?? new KeyringCredentialStore();
  const runtimeFor = (resolved: LocalModelConfig) =>
    createLocalRuntime({
      config: resolved,
      credentials: new PiCredentialStore(credentials, connectionKeyLookup(database, credentials)),
    });

  const adapter = new LocalModelProviderAdapter({ config, runtime: runtimeFor(config) });
  if (overrides.config === undefined && database !== undefined) {
    // The same credential store and lookup the boot runtime was given, so a
    // reload changes which models exist and never where keys come from.
    localReloaders.set(adapter, () => {
      const next = resolveLocalModelConfigFromSettings(database);
      adapter.reconfigure({ config: next, runtime: runtimeFor(next) });
    });
  }
  return adapter;
}

/**
 * Rebuilds a settings-backed local adapter from the current provider tables.
 *
 * Returns false when the adapter is not settings-backed (a test source, or a
 * fixed configuration), which is "nothing to reload", not a failure. A
 * rebuild that throws leaves the previous runtime in place: the settings
 * write already succeeded, and the turn path keeps working on what it had.
 */
export function reloadLocalModelAdapter(adapter: ModelProviderAdapter | undefined): boolean {
  if (!(adapter instanceof LocalModelProviderAdapter)) return false;
  const reload = localReloaders.get(adapter);
  if (reload === undefined) return false;
  reload();
  return true;
}

/**
 * The provider→key lookup the runtime's credential store consults before its
 * own legacy entries.
 *
 * A turn resolves auth by Pi provider id; the key the user typed into the
 * settings surface lives under the *connection's* id. This lookup closes that
 * gap by re-reading the merged rows at each resolution - the table is small,
 * and building the map once at startup would miss connections added while the
 * harness runs. The row's own ordering decides which connection wins when two
 * share a vendor, because the runtime's `<vendor>/<model>` reference cannot
 * express an account.
 */
function connectionKeyLookup(
  database: StudioDatabase | undefined,
  credentials: SecureCredentialStore,
): ((providerId: string) => Promise<string | undefined>) | undefined {
  if (database === undefined) return undefined;
  return async (providerId) => {
    const rows = readStoredConnections(database);
    const match = rows.find(
      ({ connection }) =>
        connection.serves.language !== undefined &&
        connection.enabled &&
        (connection.catalogProvider ?? connection.id) === providerId,
    );
    if (match === undefined) return undefined;
    try {
      const stored = await credentials.get(connectionCredentialKey(match.connection.id));
      return stored ?? undefined;
    } catch {
      // An unreadable keychain entry is treated as absent; the bridge falls
      // through to its legacy entry and the environment, exactly as it would
      // have before connections carried their own keys.
      return undefined;
    }
  };
}

/**
 * Derives the local runtime's configuration from the one provider store.
 *
 * The merged tables are the source: self-hosted connections (no
 * `catalogProvider`) become the runtime's custom providers, carrying their
 * hand-entered models with them; hand-entered models under a catalog-backed
 * connection ride along as extras registered beside the vendor's own
 * catalog. The textGeneration default - which is what the stable alias has
 * always routed to - is read from the defaults table, with the legacy
 * `local.default_model` key kept as a fallback for a database the merge
 * could not carry a default out of. Nothing writes that legacy key anymore.
 */
function resolveLocalModelConfigFromSettings(database: StudioDatabase): LocalModelConfig {
  const rows = readStoredConnections(database);
  const manuals = new ModelEdits({ db: database }).readManuals();
  const loadable = new Set(supportedCustomApis());

  const custom: CustomProviderConfig[] = [];
  const extras: ExtraProviderModelGroup[] = [];

  for (const { connection } of rows) {
    const protocol = connection.serves.language;
    if (protocol === undefined || !connection.enabled) continue;

    if (connection.catalogProvider === undefined) {
      // A self-hosted endpoint: the runtime builds a provider for it, and its
      // declared models are exactly the hand-entered rows. Each row carries
      // its own limits (or none, when the user stated none) so models of
      // wildly different sizes on one endpoint are not all measured by the
      // first row's numbers; the connection-level pair below remains as the
      // fallback for rows that state nothing.
      if (!loadable.has(protocol) || connection.baseUrl === undefined) continue;
      // Typed: an untyped `new Map()` is `Map<any, any>`, and the `any`
      // travelled out of this fallback into every field read off the models
      // below.
      const rows = [...(manuals.get(connection.id) ?? new Map<string, ProviderModel>()).values()];
      const contextWindow = firstNumber(rows.map((m) => m.capability.contextWindow));
      const maxTokens = firstNumber(rows.map((m) => m.capability.maxOutputTokens));
      custom.push({
        id: connection.id,
        name: connection.displayName,
        baseUrl: connection.baseUrl,
        api: protocol,
        models: rows.map((m) => ({
          id: m.modelId,
          contextWindow:
            typeof m.capability.contextWindow === "number" ? m.capability.contextWindow : undefined,
          maxTokens:
            typeof m.capability.maxOutputTokens === "number" ? m.capability.maxOutputTokens : undefined,
          reasoningLevels: m.reasoningLevels ?? [],
          vision: m.capability.vision === "supported",
        })),
        contextWindow,
        maxTokens,
      });
      continue;
    }

    // A catalog-backed connection: hand-entered models the vendor's own
    // catalog does not name become extras on that vendor's runtime provider.
    const manualModels = manuals.get(connection.id) ?? new Map<string, ProviderModel>();
    const known = new Set(languageCatalogModels(connection.catalogProvider).map((m) => m.id));
    const extra = [...manualModels.values()].filter((model) => !known.has(model.modelId));
    if (extra.length === 0) continue;

    const baseUrl = connection.baseUrl ?? catalogBaseUrlFor(connection.catalogProvider);
    if (baseUrl === undefined) continue;

    extras.push({
      provider: connection.catalogProvider,
      baseUrl,
      api: protocol,
      models: extra.map((model) => ({
        id: model.modelId,
        name: model.displayName,
        reasoningLevels: model.reasoningLevels ?? [],
        vision: model.capability.vision === "supported",
        contextWindow:
          typeof model.capability.contextWindow === "number"
            ? model.capability.contextWindow
            : undefined,
        maxTokens:
          typeof model.capability.maxOutputTokens === "number"
            ? model.capability.maxOutputTokens
            : undefined,
      })),
    });
  }

  const selection = resolveDefaultSelectionFromSettings(database, rows);

  return tolerantLocalModelConfig({
    ...(selection === undefined ? {} : { defaultSelection: selection }),
    customProviders: mergeCustomProviders(custom),
    extraModels: extras,
  });
}

/**
 * The stable alias's target: the merged defaults table first, the legacy
 * `local.default_model` key second, the environment last - the same order the
 * old settings store used, one store further back.
 */
function resolveDefaultSelectionFromSettings(
  database: StudioDatabase,
  rows: readonly ReturnType<typeof readStoredConnections>[number][],
): { readonly provider: string; readonly model: string } | undefined {
  const row = readDefaultSelectionRow(database);
  if (row !== undefined) {
    const match = rows.find(
      ({ connection }) =>
        connection.serves.language !== undefined && connection.id === row.connectionId,
    );
    if (match !== undefined) {
      return {
        provider: match.connection.catalogProvider ?? match.connection.id,
        model: row.modelId,
      };
    }
  }

  // The key the pre-merge runtime wrote, read and never rewritten: a default
  // the migration could not carry (its connection unknown to this build)
  // keeps routing the alias instead of vanishing.
  const raw = new AppSettings(database).namespace("local").get("default_model");
  if (raw !== undefined) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) {
        const provider = parsed.provider;
        const model = parsed.model;
        if (typeof provider === "string" && typeof model === "string") {
          return { provider, model };
        }
      }
    } catch {
      // An unreadable legacy key falls through to the environment, exactly
      // as the old store's own refusal did.
    }
  }

  return defaultSelectionFromEnvironment();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface BootstrapResult {
  readonly config: ProviderConfig;
  readonly registry: ModelRegistry;
  readonly descriptor: ModelDescriptor;
}

export class ProviderBootstrapCoordinator {
  #initialized = false;
  #result: BootstrapResult | undefined;

  bootstrap(config: ProviderConfig, options: BootstrapOptions = {}): BootstrapResult {
    if (this.#initialized) {
      throw new ProviderConfigurationError(
        "Model providers have already been bootstrapped; duplicate bootstrap is not allowed.",
      );
    }
    this.#initialized = true;

    const adapter = createModelProviderAdapter(config.source, options);
    adapter.register();

    const registry = new ModelRegistry();
    registry.registerAdapter(adapter);

    const descriptor = registry.resolveDescriptor(
      defaultModelReference(config.source),
    );

    this.#result = { config, registry, descriptor };
    return this.#result;
  }

  /** What this process bootstrapped, or undefined before that happened. */
  get current(): BootstrapResult | undefined {
    return this.#result;
  }

  /**
   * Re-reads provider settings into the bootstrapped local source.
   *
   * Called after a provider connection, model or default changes, so what
   * the catalog admits and what the runtime can route stay one set without
   * a restart. Undefined before bootstrap and false for a source with
   * nothing to reload.
   */
  reloadFromSettings(): boolean {
    const result = this.#result;
    if (result === undefined) return false;
    const adapter = result.registry.getAdapter("local");
    if (!reloadLocalModelAdapter(adapter)) return false;
    this.#result = {
      ...result,
      descriptor: result.registry.resolveDescriptor(defaultModelReference(result.config.source)),
    };
    return true;
  }
}

export function createProviderBootstrapCoordinator(): ProviderBootstrapCoordinator {
  return new ProviderBootstrapCoordinator();
}

const productionCoordinator = createProviderBootstrapCoordinator();

export function bootstrapModelProviders(
  config: ProviderConfig,
  options: BootstrapOptions = {},
): BootstrapResult {
  return productionCoordinator.bootstrap(config, options);
}

/**
 * Makes provider-settings changes reach the running local source.
 *
 * Observed as its own operation under whatever request made the change: the
 * outcome says whether the runtime now matches settings, and a failure is
 * recorded and swallowed - the caller's write is already durable, and the
 * previous runtime keeps serving until the next successful reload.
 */
export function reloadModelProvidersFromSettings(): Promise<boolean> {
  return observeOperation("provider", "provider.language.reload", async () => {
    try {
      return productionCoordinator.reloadFromSettings();
    } catch (error) {
      recordObservation({
        name: "provider.language.reload.failed",
        phase: "progress",
        attributes: { errorCode: observationFailure(error).errorCode },
      });
      return false;
    }
  });
}

/**
 * The model registry this process bootstrapped, without importing a side
 * effect to get it.
 *
 * The composition root runs the bootstrap and used to drop the result; the
 * registry existed only for Flue's routing. Answering "can the conversation's
 * model see images" needs the same catalog, and building a second runtime to
 * ask one capability question would be a second copy of the model source
 * (the mistake ADR 0035 §3 exists for). Undefined until the bootstrap ran,
 * which every consumer reads as unknown rather than unsupported.
 */
export function bootstrappedModelRegistry(): ModelRegistry | undefined {
  return productionCoordinator.current?.registry;
}

/**
 * The reasoning levels one stored reference supports, from the bootstrapped
 * source, synchronously.
 *
 * The agent render cannot await, so it reads here rather than through the
 * async `ModelCatalog`. Before the bootstrap ran there is no catalog to read,
 * and the honest fallback is medium itself: the resting level for the common
 * case, which keeps the request on the explicit path rather than on silence.
 */
export function bootstrappedSupportedReasoningLevels(
  modelId: string | null,
): readonly ReasoningLevel[] {
  const registry = productionCoordinator.current?.registry;
  if (registry === undefined) return ["medium"];
  const local = registry.getAdapter("local");
  if (local !== undefined) return local.supportedReasoningLevels(modelId);
  const test = registry.getAdapter("test");
  if (test !== undefined) return test.supportedReasoningLevels(modelId);
  return ["medium"];
}

/** See `ModelProviderAdapter.quietThinkingLevel`; "off" when no source can say. */
export function bootstrappedQuietThinkingLevel(
  modelId: string | null,
): ReasoningLevel | "off" {
  const registry = productionCoordinator.current?.registry;
  const adapter = registry?.getAdapter("local") ?? registry?.getAdapter("test");
  return adapter?.quietThinkingLevel?.(modelId) ?? "off";
}

function firstNumber(values: readonly (number | "unknown")[]): number | undefined {
  for (const value of values) {
    if (typeof value === "number") return value;
  }
  return undefined;
}

/**
 * The window and output cap of one stored reference, from the bootstrapped
 * source, synchronously - the two numbers the compaction policy stands on.
 *
 * Read the same way the reasoning levels are: the agent render cannot await,
 * and the registry resolves a descriptor without touching the keychain. Null
 * is the stable alias. Before the bootstrap ran, and for a reference that
 * does not resolve, both answer unknown, which the policy reads as "no
 * threshold" rather than as any particular size.
 */
export function bootstrappedModelLimits(modelId: string | null): {
  readonly contextWindow: number | "unknown";
  readonly maxOutputTokens: number | "unknown";
} {
  const registry = productionCoordinator.current?.registry;
  const source = registry?.hasSource("local") ? "local" : registry?.hasSource("test") ? "test" : undefined;
  if (registry === undefined || source === undefined) {
    return { contextWindow: "unknown", maxOutputTokens: "unknown" };
  }
  try {
    const descriptor = registry.resolveDescriptor({
      source,
      provider: DEFAULT_MODEL_PROVIDER,
      model: modelId ?? DEFAULT_MODEL_NAME,
    });
    return {
      contextWindow: descriptor.capability.contextWindow,
      maxOutputTokens: descriptor.capability.maxOutputTokens,
    };
  } catch {
    return { contextWindow: "unknown", maxOutputTokens: "unknown" };
  }
}
