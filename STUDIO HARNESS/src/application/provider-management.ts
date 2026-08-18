import type { AuthContext } from "../admission/context.js";
import type {
  CapabilitySlot,
  DefaultSelection,
  ProviderConnection,
  ProviderConnectionDraft,
  ProviderConnectionPatch,
  ProviderKind,
  ProviderModel,
} from "../contracts/providers.js";
import type { ConnectionStore } from "../providers/connection-store.js";
import type { ManualModelInput, ModelCatalog } from "../providers/model-catalog.js";

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
 * omissions are deliberate: `getConnection` serves no route in the surface,
 * and `probeConnection` has no implementation to delegate to — a method that
 * always fails would be worse than an absent one, so it is left off rather
 * than stubbed.
 */
export interface ProviderAdministration {
  listConnections(): Promise<readonly ProviderConnection[]>;
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

  listModels(filter?: ProviderModelFilter): Promise<readonly ProviderModel[]>;
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

  constructor(options: ProviderManagementOptions) {
    this.#connections = options.connections;
    this.#catalog = options.catalog;
  }

  listConnections(): Promise<readonly ProviderConnection[]> {
    return this.#connections.list();
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
    return this.#connections.add(draft);
  }

  async updateConnection(
    id: string,
    patch: ProviderConnectionPatch,
    _auth: AuthContext,
  ): Promise<ProviderConnection> {
    return this.#connections.update(id, patch);
  }

  async removeConnection(id: string, _auth: AuthContext): Promise<void> {
    // Keychain first, then the row; the model tables follow by cascade, which
    // the database enforces rather than this service remembering.
    return this.#connections.remove(id);
  }

  listModels(
    filter?: ProviderModelFilter,
  ): Promise<readonly ProviderModel[]> {
    return this.#catalog.listModels(filter);
  }

  addManualModel(
    connectionId: string,
    model: ManualModelInput,
    _auth: AuthContext,
  ): Promise<ProviderModel> {
    return this.#catalog.addManualModel(connectionId, model);
  }

  setModelOverride(
    connectionId: string,
    modelId: string,
    patch: ModelOverridePatch,
    _auth: AuthContext,
  ): Promise<ProviderModel> {
    return this.#catalog.setOverride(connectionId, modelId, patch);
  }

  removeModel(
    connectionId: string,
    modelId: string,
    _auth: AuthContext,
  ): Promise<void> {
    return this.#catalog.removeModel(connectionId, modelId);
  }

  getDefaults(): Promise<DefaultSelection> {
    return this.#catalog.getDefaults();
  }

  setDefault(
    slot: CapabilitySlot,
    ref: DefaultReference | undefined,
    _auth: AuthContext,
  ): Promise<void> {
    return this.#catalog.setDefault(slot, ref);
  }
}
