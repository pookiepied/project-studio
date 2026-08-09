import type { SecureCredentialStore } from "../credentials/credential-store.js";
import { RetrievalError } from "./errors.js";
import {
  READER_PROVIDERS,
  SEARCH_PROVIDERS,
} from "./registry.js";
import type { RetrievalCapability, RetrievalSettingsStore } from "./settings.js";
import { runWithFallback, type ProviderSlots, type SlotOutcome } from "./slots.js";
import type {
  ProviderFactory,
  ReaderProvider,
  ReadResult,
  RetrievalProvider,
  SearchProvider,
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
}

export class RetrievalService {
  readonly #settings: RetrievalSettingsStore;
  readonly #credentials: SecureCredentialStore;

  constructor(options: RetrievalServiceOptions) {
    this.#settings = options.settings;
    this.#credentials = options.credentials;
  }

  async search(
    query: string,
    limit: number,
    signal: AbortSignal | undefined,
  ): Promise<SlotOutcome<SearchResult>> {
    const slots = await this.#slotsFor("search", SEARCH_PROVIDERS);
    return runWithFallback(slots, (provider) =>
      provider.search({ query, limit, signal }),
    );
  }

  async read(
    url: string,
    signal: AbortSignal | undefined,
  ): Promise<SlotOutcome<ReadResult>> {
    const slots = await this.#slotsFor("reader", READER_PROVIDERS);
    // The one place `blocked` advances the slot. A site refusing one reader is
    // exactly what a different reader is for; a search service refusing us is
    // not. See `runWithFallback`.
    return runWithFallback(slots, (provider) => provider.read({ url, signal }), {
      allowFallbackOnBlocked: true,
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
    const ids = [selection.primary, selection.fallback].filter(
      (id): id is string => id !== undefined,
    );

    const built: T[] = [];
    for (const id of ids) {
      const factory = factories[id];
      if (!factory) continue;
      const key = await this.#credentials.get({ scope: "provider", id });
      if (key === null || key === "") continue;
      built.push(factory(key));
    }

    const primary = built[0];
    if (!primary) {
      throw new RetrievalError("unauthorized", {
        message:
          capability === "search"
            ? `No search provider is connected. Add a key for ${selection.primary} in settings.`
            : `No page reader is connected. Add a key for ${selection.primary} in settings.`,
      });
    }

    return { primary, fallback: built[1] };
  }
}

export type { SearchProvider, ReaderProvider };
