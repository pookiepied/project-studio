import type {
  CapabilitySlot,
  CredentialStatus,
  DefaultSelection,
  ProviderConnection,
  ProviderModel,
} from "../../contracts/providers.js";
import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import {
  connectionCredentialSecret,
  legacyProviderCredentialKey,
} from "./connection-credentials.js";
import type { ConnectionStore } from "./connection-store.js";
import type { ModelCatalog } from "./model-catalog.js";

/**
 * The capability selection seam: the one way to ask "which provider and model
 * did the user choose for this capability, and what is its credential".
 *
 * This is what Task 40's Studio MCP servers - `studio-image`, `studio-video`,
 * `studio-web-search`, `studio-web-fetch`, and their speech and transcription
 * siblings - will read. A server does not know about connections, keychain
 * scopes, or the defaults table; it names a slot and receives the settled
 * answer: the connection (which protocol to speak and where), the model (which
 * endpoint shape to drive), and the credential, resolved through the same
 * chain the probe uses.
 *
 * The credential is handed only to the process that will invoke the model -
 * it never enters a route response, a log line, or this module's return value
 * on any UI path. A slot with no default, or a default whose model has
 * vanished, resolves to `undefined`: the caller says what is missing, and
 * nothing silently falls back.
 */

export interface CapabilityResolution {
  readonly slot: CapabilitySlot;
  readonly connection: ProviderConnection;
  readonly model: ProviderModel;
  /**
   * The resolved credential, or undefined when none resolves. A loopback
   * endpoint legitimately needs none; a remote one without a key will fail
   * its provider-side auth, which is the honest outcome.
   */
  readonly credential: string | undefined;
}

export interface CapabilityResolverOptions {
  readonly connections: ConnectionStore;
  readonly catalog: ModelCatalog;
  readonly credentials: SecureCredentialStore;
}

export class CapabilityResolver {
  readonly #connections: ConnectionStore;
  readonly #catalog: ModelCatalog;
  readonly #credentials: SecureCredentialStore;

  constructor(options: CapabilityResolverOptions) {
    this.#connections = options.connections;
    this.#catalog = options.catalog;
    this.#credentials = options.credentials;
  }

  /**
   * The user's choice for one capability slot, with its credential.
   *
   * Resolves to undefined when the slot is unset, when the referenced
   * connection no longer exists, or when the referenced model is no longer
   * in the catalog. A model the provider has stopped offering still resolves:
   * the invocation will fail against the provider, which is a truer answer
   * than pretending the user never made the choice.
   */
  async resolve(slot: CapabilitySlot): Promise<CapabilityResolution | undefined> {
    const defaults: DefaultSelection = await this.#catalog.getDefaults();
    const reference = defaults[slot];
    if (reference === undefined) return undefined;

    const connection = await this.#connections.get(reference.connectionId);
    if (connection === undefined) return undefined;

    const models = await this.#catalog.listModels({ connectionId: connection.id });
    const model = models.find((entry) => entry.modelId === reference.modelId);
    if (model === undefined) return undefined;

    const credential = await connectionCredentialSecret(this.#credentials, connection);
    return { slot, connection, model, credential };
  }

  /**
   * Credential presence without the secret, for surfaces that may only show
   * whether a slot is usable.
   */
  async statusFor(connection: ProviderConnection): Promise<CredentialStatus> {
    const secret = await connectionCredentialSecret(this.#credentials, connection);
    if (secret !== undefined) return "set";
    return connection.credential;
  }
}

/**
 * The retrieval runtime's view of the merged defaults.
 *
 * The web tools resolve a vendor id (`tavily`, `jina`, ...) and a key; the
 * merged store speaks in connections and models. This class is the join: the
 * `webSearch` / `webFetch` slots decide the vendor, and the credential chain
 * - the connection's own key, then the vendor's legacy entry - decides the
 * key. When no default is set the answers are undefined and the caller falls
 * back to its own legacy settings, which nothing deletes.
 */
export class MergedRetrievalResolver {
  readonly #connections: ConnectionStore;
  readonly #credentials: SecureCredentialStore;
  readonly #resolver: CapabilityResolver;

  constructor(options: CapabilityResolverOptions) {
    this.#connections = options.connections;
    this.#credentials = options.credentials;
    this.#resolver = new CapabilityResolver(options);
  }

  /** The vendor id the user's default names, or undefined when unset. */
  async selectionFor(capability: "search" | "reader"): Promise<string | undefined> {
    const resolution = await this.#resolver.resolve(
      capability === "search" ? "webSearch" : "webFetch",
    );
    if (resolution === undefined) return undefined;
    if (resolution.connection.kind !== "retrieval") return undefined;
    return resolution.connection.protocol;
  }

  /**
   * The key for one vendor: from its merged connection when one exists, else
   * from the legacy entry the retrieval routes have always written - a raw
   * secret under the vendor's own name, which is why it is read here as a
   * plain value rather than through the Pi bridge's JSON format.
   */
  async keyFor(vendorId: string): Promise<string | undefined> {
    const connections = await this.#connections.list();
    const connection = connections.find(
      (candidate) => candidate.kind === "retrieval" && candidate.protocol === vendorId,
    );
    if (connection !== undefined) {
      const fromConnection = await connectionCredentialSecret(this.#credentials, connection);
      if (fromConnection !== undefined) return fromConnection;
    }

    const legacy = await this.#credentials.get(legacyProviderCredentialKey(vendorId));
    return legacy ?? undefined;
  }
}
