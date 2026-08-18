import type { AuthContext } from "../admission/context.js";
import type {
  CapabilitySlot,
  DefaultSelection,
  ProbeResult,
  ProviderConnection,
  ProviderConnectionDraft,
  ProviderConnectionPatch,
  ProviderKind,
  ProviderModel,
} from "../contracts/providers.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import { probeProviderConnection } from "../providers/connection-probe.js";
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
 * omissions are deliberate: `getConnection` serves the update and probe
 * routes' existence checks rather than a route of its own.
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
  /**
   * Tests one connection against its live endpoint.
   *
   * Every provider-side outcome comes back inside the `ProbeResult`; the only
   * throw is a connection that does not exist, so a route can hand the body
   * straight back without sorting exceptions into successes.
   */
  probeConnection(id: string, auth: AuthContext): Promise<ProbeResult>;

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

    return probeProviderConnection(connection, apiKey);
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
