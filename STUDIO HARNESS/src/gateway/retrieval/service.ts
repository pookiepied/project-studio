import type { SecureCredentialStore } from "../../credentials/credential-store.js";
import { RetrievalError } from "./errors.js";
import { observeOperation } from "../../observability/operation.js";
import {
  READER_PROVIDERS,
  SEARCH_PROVIDERS,
} from "./registry.js";
import type { RetrievalCapability, RetrievalSettingsStore } from "./settings.js";
import { runWithFallback, type ProviderSlots, type SlotOutcome } from "./slots.js";
import type {
  ProviderFactory,
  ReadResult,
  RetrievalProvider,
  SearchResult,
} from "./types.js";

/**
 * The subsystem's front door.
 *
 * `web_search` and `fetch` call this and nothing else. They never name a
 * provider, never read a key, and never see a vendor's status code — which is
 * what lets a provider be added, swapped, or removed without touching a tool or
 * the prompt the model sees.
 *
 * Providers are built per call rather than held. A key can change in settings
 * at any moment, and a cached provider would go on using the old one until a
 * restart.
 */

export interface RetrievalServiceOptions {
  readonly settings: RetrievalSettingsStore;
  readonly credentials: SecureCredentialStore;
  /**
   * The merged provider store's answer for these slots, when wired.
   *
   * A `webSearch` / `webFetch` default set in the settings surface decides the
   * vendor; a key typed for its connection decides the credential. When absent
   * - unset slots, or callers not wired to the merged store - the legacy
   * `retrieval.*` settings and `provider:` keys decide, unchanged.
   */
  readonly merged?: MergedRetrievalLink | undefined;
}

/** How the service consults the merged provider store, when it is wired to one. */
export interface MergedRetrievalLink {
  readonly selectionFor: (capability: RetrievalCapability) => Promise<string | undefined>;
  readonly keyFor: (vendorId: string) => Promise<string | undefined>;
}

export class RetrievalService {
  readonly #settings: RetrievalSettingsStore;
  readonly #credentials: SecureCredentialStore;
  readonly #merged: MergedRetrievalLink | undefined;

  constructor(options: RetrievalServiceOptions) {
    this.#settings = options.settings;
    this.#credentials = options.credentials;
    this.#merged = options.merged;
  }

  async search(
    query: string,
    limit: number,
    signal: AbortSignal | undefined,
  ): Promise<SlotOutcome<SearchResult>> {
    return observeOperation("provider", "retrieval.search", async () => {
      const slots = await this.#slotsFor("search", SEARCH_PROVIDERS);
      return runWithFallback(slots, (provider) => observeOperation("provider", "retrieval.provider",
        () => provider.search({ query, limit, signal }), { capability: "search", provider: provider.id }));
    });
  }

  async read(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<SlotOutcome<ReadResult>> {
    return observeOperation("provider", "retrieval.read", async () => {
      const slots = await this.#slotsFor("reader", READER_PROVIDERS);
      // Only a reader's blocked result advances to another provider.
      return runWithFallback(slots, (provider) => observeOperation("provider", "retrieval.provider",
        () => provider.read({ url, signal }), { capability: "reader", provider: provider.id }), {
        allowFallbackOnBlocked: true,
      });
    });
  }

  /**
   * Builds both slots, skipping any provider with no key stored.
   *
   * A configured provider without a key is treated as not configured, not as an
   * error. Onboarding sets the choice and the key in one step, but settings can
   * remove a key on its own, and the honest reading of "chosen but no key" is
   * that the user has not finished connecting it.
   *
   * When the primary has no key and the fallback does, the fallback is promoted
   * rather than the call failing. The user connected a service; refusing to use
   * it because of the label on its slot would be pedantry.
   */
  async #slotsFor<T extends RetrievalProvider>(
    capability: RetrievalCapability,
    factories: Readonly<Record<string, ProviderFactory<T>>>,
  ): Promise<ProviderSlots<T>> {
    const selection = this.#settings.read(capability);
    // The merged default outranks the legacy primary when both exist; the
    // legacy fallback stays a fallback. A default naming the same vendor as
    // the legacy primary must not produce the same slot twice.
    const mergedPrimary = this.#merged === undefined ? undefined : await this.#merged.selectionFor(capability);
    const primary = mergedPrimary ?? selection.primary;
    const fallback =
      selection.fallback !== undefined && selection.fallback !== primary
        ? selection.fallback
        : undefined;
    const ids = [primary, fallback].filter(
      (id): id is string => id !== undefined,
    );

    const built: T[] = [];
    for (const id of ids) {
      const factory = factories[id];
      if (!factory) continue;
      const key = this.#merged === undefined
        ? await this.#credentials.get({ scope: "provider", id })
        : await this.#merged.keyFor(id);
      if (key === null || key === undefined || key === "") continue;
      built.push(factory(key));
    }

    const builtPrimary = built[0];
    if (!builtPrimary) {
      throw new RetrievalError("unauthorized", {
        message:
          capability === "search"
            ? `No search provider is connected. Add a key for ${primary} in settings.`
            : `No page reader is connected. Add a key for ${primary} in settings.`,
      });
    }

    return { primary: builtPrimary, fallback: built[1] };
  }
}

