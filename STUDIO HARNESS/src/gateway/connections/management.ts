import type { AuthContext } from "../../admission/context.js";
import type {
  CapabilitySlot,
  DefaultSelection,
  ProbeResult,
  ProviderConnection,
  ProviderConnectionDraft,
  ProviderConnectionPatch,
  ProviderKind,
  ProviderModel,
} from "../../contracts/providers.js";
import { ProviderConfigurationError } from "../../contracts/models.js";
import {
  probeProviderConnectionDetailed,
} from "./connection-probe.js";
import { listLibraryProviders, type LibraryProviderEntry } from "../catalog/index.js";
import { ProviderIconCatalog } from "../catalog/icons/index.js";
import type { ConnectionStore } from "./connection-store.js";
import type { ManualModelInput, ModelCatalog } from "./model-catalog.js";

export interface ProviderModelFilter {
  readonly connectionId?: string;
  readonly kind?: ProviderKind;
  readonly capability?: CapabilitySlot;
}

export type ModelOverridePatch = {
  readonly displayName?: string;
  readonly hidden?: boolean;
};

export type DefaultReference = {
  readonly connectionId: string;
  readonly modelId: string;
};

/**
 * Everything the HTTP surface needs, and nothing else.
 *
 * `ProviderPort` is the shape the frontend talks to; this is the slice a route
 * actually calls, composed the way `McpAdministration` is (ADR 0035 §2). The
 * omissions are deliberate: `getConnection` serves the update and probe
 * routes' existence checks rather than a route of its own.
 */
export interface ProviderAdministration {
  listConnections(): Promise<readonly ProviderConnection[]>;
  /** The providers any of the three catalogs can name, with what each serves. */
  listLibrary(): Promise<readonly LibraryProviderEntry[]>;
  /**
   * One vendor's real icon, as SVG text, from the on-disk cache. Undefined is
   * the ordinary answer - unknown vendor, no icon published, or offline - and
   * the caller draws its fallback mark.
   */
  getProviderIcon(providerId: string): Promise<string | undefined>;
  getConnection(id: string): Promise<ProviderConnection | undefined>;
  addConnection(
    draft: ProviderConnectionDraft,
    auth: AuthContext,
  ): Promise<ProviderConnection>;
  updateConnection(
    id: string,
    patch: ProviderConnectionPatch,
    auth: AuthContext,
  ): Promise<ProviderConnection>;
  removeConnection(id: string, auth: AuthContext): Promise<void>;
  /**
   * Tests one connection against its live endpoint.
   *
   * Every provider-side outcome comes back inside the `ProbeResult`; the only
   * throw is a connection that does not exist, so a route can hand the body
   * straight back without sorting exceptions into successes.
   */
  probeConnection(id: string, auth: AuthContext): Promise<ProbeResult>;

  listModels(filter?: ProviderModelFilter): Promise<readonly ProviderModel[]>;
  /**
   * The model references the catalog currently serves, in the run's own
   * `<provider>/<model>` vocabulary - the set a submission's chosen model is
   * settled against at admission. Served by the catalog, which owns both the
   * connection records and the model list this is derived from.
   */
  servedModelReferences(): Promise<ReadonlySet<string>>;
  addManualModel(
    connectionId: string,
    model: ManualModelInput,
    auth: AuthContext,
  ): Promise<ProviderModel>;
  setModelOverride(
    connectionId: string,
    modelId: string,
    patch: ModelOverridePatch,
    auth: AuthContext,
  ): Promise<ProviderModel>;
  setModelSelection(
    connectionId: string,
    selectedModelIds: readonly string[],
    auth: AuthContext,
  ): Promise<void>;
  removeModel(
    connectionId: string,
    modelId: string,
    auth: AuthContext,
  ): Promise<void>;

  getDefaults(): Promise<DefaultSelection>;
  setDefault(
    slot: CapabilitySlot,
    ref: DefaultReference | undefined,
    auth: AuthContext,
  ): Promise<void>;
}

export interface ProviderManagementOptions {
  readonly connections: ConnectionStore;
  readonly catalog: ModelCatalog;
  /** Real provider icons; absent in tests that do not exercise the surface. */
  readonly icons?: ProviderIconCatalog;
  /**
   * Called after a write that can change which language models the runtime
   * routes: a connection, a model row or a default. The composition root
   * rebuilds the local source from settings here, so a model added in
   * settings answers its first turn without a restart. Its failure never
   * becomes the write's failure - the write is already durable.
   */
  readonly onLanguageSettingsChanged?: () => unknown;
}

/**
 * Joins the connection store and the model catalog behind one interface.
 *
 * The two stores own different tables and neither may reach the other's, so
 * the join belongs here where authorization and validation can sit in front of
 * both — the same reason `McpManagementService` exists between the routes and
 * the registry.
 */
export class ProviderManagementService implements ProviderAdministration {
  readonly #connections: ConnectionStore;
  readonly #catalog: ModelCatalog;
  readonly #icons: ProviderIconCatalog | undefined;
  readonly #onLanguageSettingsChanged: (() => unknown) | undefined;

  constructor(options: ProviderManagementOptions) {
    this.#connections = options.connections;
    this.#catalog = options.catalog;
    this.#icons = options.icons;
    this.#onLanguageSettingsChanged = options.onLanguageSettingsChanged;
  }

  /** Runs the change hook once a write has landed; never alters its result. */
  async #changed<T>(value: T): Promise<T> {
    try {
      await this.#onLanguageSettingsChanged?.();
    } catch {
      // The hook reports its own failures; the write it follows succeeded.
    }
    return value;
  }

  listConnections(): Promise<readonly ProviderConnection[]> {
    return this.#connections.list();
  }

  listLibrary(): Promise<readonly LibraryProviderEntry[]> {
    return listLibraryProviders();
  }

  async getProviderIcon(providerId: string): Promise<string | undefined> {
    if (this.#icons === undefined) return undefined;
    return this.#icons.get(providerId);
  }

  getConnection(id: string): Promise<ProviderConnection | undefined> {
    return this.#connections.get(id);
  }

  async addConnection(
    draft: ProviderConnectionDraft,
    _auth: AuthContext,
  ): Promise<ProviderConnection> {
    // The store writes the key to the OS credential store and only the
    // non-secret record to the database, so the connection this returns is the
    // one shape that can never carry the key back out.
    return this.#changed(await this.#connections.add(draft));
  }

  async updateConnection(
    id: string,
    patch: ProviderConnectionPatch,
    _auth: AuthContext,
  ): Promise<ProviderConnection> {
    return this.#changed(await this.#connections.update(id, patch));
  }

  async removeConnection(id: string, _auth: AuthContext): Promise<void> {
    // Keychain first, then the row; the model tables follow by cascade, which
    // the database enforces rather than this service remembering.
    await this.#connections.remove(id);
    await this.#changed(undefined);
  }

  async probeConnection(id: string, _auth: AuthContext): Promise<ProbeResult> {
    const connection = await this.#connections.get(id);
    if (connection === undefined) {
      throw new ProviderConfigurationError(
        `Provider connection "${id}" does not exist.`,
      );
    }

    let apiKey: string | undefined;
    try {
      apiKey = await this.#connections.credentialFor(id);
    } catch {
      // A locked keychain is our side of the fence, not the provider's, and
      // probing without the key would misreport a 401 the provider never
      // issued. Said plainly instead.
      return {
        ok: false,
        reachedAt: Date.now(),
        failure:
          "The credential for this connection could not be read from the secure store, so it was not probed.",
      };
    }

    // The detailed run also records what the provider's own list named, so
    // the catalog can mark what the provider no longer offers, and adopts
    // what a self-hosted endpoint serves but has no row for yet, so a custom
    // provider is add, probe, pick with no hand-entering. What reaches
    // the wire is the plain result: the screen wants the count, not the ids.
    const detailed = await probeProviderConnectionDetailed(connection, apiKey);
    if (detailed.ok && detailed.servedIds !== undefined) {
      try {
        this.#catalog.recordServedModels(id, detailed.servedIds);
      } catch {
        // Learning is an enhancement to the answer, never a condition of it:
        // a probe that could not persist its list still reports what it saw.
      }
      try {
        const adopted = await this.#catalog.adoptServedModels(id, detailed.servedIds);
        if (adopted.length > 0) await this.#changed(undefined);
      } catch {
        // Adoption is learning too: a probe that could not add rows still
        // reports what it saw.
      }
    }
    return detailed;
  }

  listModels(
    filter?: ProviderModelFilter,
  ): Promise<readonly ProviderModel[]> {
    return this.#catalog.listModels(filter);
  }

  servedModelReferences(): Promise<ReadonlySet<string>> {
    return this.#catalog.servedModelReferences();
  }

  async addManualModel(
    connectionId: string,
    model: ManualModelInput,
    _auth: AuthContext,
  ): Promise<ProviderModel> {
    return this.#changed(await this.#catalog.addManualModel(connectionId, model));
  }

  setModelOverride(
    connectionId: string,
    modelId: string,
    patch: ModelOverridePatch,
    _auth: AuthContext,
  ): Promise<ProviderModel> {
    return this.#catalog.setOverride(connectionId, modelId, patch);
  }

  async setModelSelection(
    connectionId: string,
    selectedModelIds: readonly string[],
    _auth: AuthContext,
  ): Promise<void> {
    return this.#catalog.setModelSelection(connectionId, selectedModelIds);
  }

  async removeModel(
    connectionId: string,
    modelId: string,
    _auth: AuthContext,
  ): Promise<void> {
    await this.#catalog.removeModel(connectionId, modelId);
    await this.#changed(undefined);
  }

  getDefaults(): Promise<DefaultSelection> {
    return this.#catalog.getDefaults();
  }

  async setDefault(
    slot: CapabilitySlot,
    ref: DefaultReference | undefined,
    _auth: AuthContext,
  ): Promise<void> {
    await this.#catalog.setDefault(slot, ref);
    // Only the text default is the alias's target; other slots resolve per
    // call through the capability resolver and need no runtime rebuild.
    if (slot === "textGeneration") await this.#changed(undefined);
  }
}
