import type { AuthContext } from "../admission/context.js";
import { ProviderConfigurationError } from "../contracts/models.js";
import {
  assertValidKey,
  type CredentialKey,
  type SecureCredentialStore,
} from "../credentials/credential-store.js";
import {
  READER_PROVIDERS,
  SEARCH_PROVIDERS,
  isReaderProviderId,
  isSearchProviderId,
} from "../gateway/retrieval/registry.js";
import type {
  RetrievalCapability,
  RetrievalSettingsStore,
  RetrievalSlot,
} from "../gateway/retrieval/settings.js";

/**
 * The retrieval settings surface — a sibling of `ProviderAdministration`,
 * not a section of it.
 *
 * BYOK connections are rows a user creates, lists, and deletes; retrieval is
 * a fixed registry the harness ships with, where the only user data is one
 * key and one slot choice per provider. Forcing the second under the first
 * would make the provider service depend on retrieval's stores and give the
 * routes a port wider than any route calls — the coupling `McpAdministration`
 * was split to avoid (ADR 0035 §2). Same tree, same scope, sibling port.
 */

export type RetrievalCredentialStatus = "set" | "absent";

export interface RetrievalProviderStatus {
  readonly id: string;
  readonly credential: RetrievalCredentialStatus;
}

/** One capability's providers and which of them currently fill the slots. */
export interface RetrievalCapabilityStatus {
  readonly capability: RetrievalCapability;
  readonly providers: readonly RetrievalProviderStatus[];
  readonly primary: string;
  /** Absent is a valid answer: one provider and a good error. */
  readonly fallback: string | undefined;
}

/** The two capabilities, kept apart because they answer different questions. */
export interface RetrievalStatus {
  readonly search: RetrievalCapabilityStatus;
  readonly reader: RetrievalCapabilityStatus;
}

/**
 * Everything the retrieval routes call, and nothing else — the slice of this
 * surface a route needs, the way `ProviderAdministration` is for connections.
 */
export interface RetrievalAdministration {
  listRetrieval(): Promise<RetrievalStatus>;
  setRetrievalKey(
    providerId: string,
    secret: string,
    auth: AuthContext,
  ): Promise<void>;
  clearRetrievalKey(providerId: string, auth: AuthContext): Promise<void>;
  setRetrievalSlot(
    capability: RetrievalCapability,
    slot: RetrievalSlot,
    providerId: string | undefined,
    auth: AuthContext,
  ): Promise<void>;
}

export interface RetrievalManagementOptions {
  readonly settings: RetrievalSettingsStore;
  readonly credentials: SecureCredentialStore;
}

export class RetrievalManagementService implements RetrievalAdministration {
  readonly #settings: RetrievalSettingsStore;
  readonly #credentials: SecureCredentialStore;

  constructor(options: RetrievalManagementOptions) {
    this.#settings = options.settings;
    this.#credentials = options.credentials;
  }

  async listRetrieval(): Promise<RetrievalStatus> {
    return {
      search: await this.#capabilityStatus("search"),
      reader: await this.#capabilityStatus("reader"),
    };
  }

  async setRetrievalKey(
    providerId: string,
    secret: string,
    _auth: AuthContext,
  ): Promise<void> {
    this.#requireKnownProvider(providerId);
    if (secret === "") {
      throw new ProviderConfigurationError(
        "A retrieval API key must not be empty.",
      );
    }
    await this.#credentials.set(retrievalCredentialKey(providerId), secret);
  }

  async clearRetrievalKey(
    providerId: string,
    _auth: AuthContext,
  ): Promise<void> {
    this.#requireKnownProvider(providerId);
    await this.#credentials.delete(retrievalCredentialKey(providerId));
  }

  /**
   * Records a slot choice. `undefined` clears the slot; the store's own read
   * semantics — unknown or duplicate ids ignored — stay authoritative, so the
   * tool path resolves identically before and after this surface exists.
   */
  async setRetrievalSlot(
    capability: RetrievalCapability,
    slot: RetrievalSlot,
    providerId: string | undefined,
    _auth: AuthContext,
  ): Promise<void> {
    if (providerId !== undefined && !isKnownProvider(capability, providerId)) {
      throw new ProviderConfigurationError(
        `"${providerId}" is not a ${capability} provider the harness knows.`,
      );
    }
    this.#settings.select(capability, slot, providerId);
  }

  async #capabilityStatus(
    capability: RetrievalCapability,
  ): Promise<RetrievalCapabilityStatus> {
    const ids = Object.keys(
      capability === "search" ? SEARCH_PROVIDERS : READER_PROVIDERS,
    );
    const selection = this.#settings.read(capability);

    const providers: RetrievalProviderStatus[] = [];
    for (const id of ids) {
      // Presence only: the value never enters an object a route could
      // serialize. An empty string counts as absent because the tool path
      // treats it that way when building slots.
      let stored: string | null;
      try {
        stored = await this.#credentials.get(retrievalCredentialKey(id));
      } catch {
        stored = null;
      }
      providers.push({
        id,
        credential: stored !== null && stored !== "" ? "set" : "absent",
      });
    }

    return { capability, providers, primary: selection.primary, fallback: selection.fallback };
  }

  #requireKnownProvider(providerId: string): void {
    if (!isSearchProviderId(providerId) && !isReaderProviderId(providerId)) {
      throw new ProviderConfigurationError(
        `"${providerId}" is not a retrieval provider the harness knows.`,
      );
    }
  }
}

function isKnownProvider(
  capability: RetrievalCapability,
  id: string,
): boolean {
  return capability === "search" ? isSearchProviderId(id) : isReaderProviderId(id);
}

/**
 * Where a retrieval provider's key lives: the same `{scope: "provider", id}`
 * `RetrievalService` reads at call time (service.ts `#slotsFor`). The service
 * is the definition and cannot change here (its resolution must stay
 * identical), so this module's one job is to not drift from it — a key set
 * through the management surface is the key `web_search` will present.
 */
function retrievalCredentialKey(providerId: string): CredentialKey {
  return assertValidKey({ scope: "provider", id: providerId });
}
