import { AppSettings, type NamespacedSettings } from "../storage/app-settings.js";
import type { StudioDatabase } from "../storage/database.js";
import {
  DEFAULT_READER_PROVIDER,
  DEFAULT_SEARCH_PROVIDER,
  isReaderProviderId,
  isSearchProviderId,
} from "./registry.js";

/**
 * Which provider fills each slot.
 *
 * The non-secret half, exactly as the merged provider store is for BYOK models.
 * The API key is in the OS keychain and is never read here; what lives in
 * SQLite is the choice, because a keychain cannot enumerate itself and a
 * settings screen has to render something.
 *
 * Nothing in this module accepts, returns, or stores key material.
 */

export type RetrievalCapability = "search" | "reader";
export type RetrievalSlot = "primary" | "fallback";

export interface SlotSelection {
  readonly primary: string;
  /** Absent is a valid answer: one provider and a good error. */
  readonly fallback: string | undefined;
}

/** Relative to the `retrieval` namespace, which supplies the prefix. */
function settingKey(capability: RetrievalCapability, slot: RetrievalSlot): string {
  return `${capability}.${slot}`;
}

function isKnown(capability: RetrievalCapability, id: string): boolean {
  return capability === "search" ? isSearchProviderId(id) : isReaderProviderId(id);
}

export class RetrievalSettingsStore {
  /** `app_setting` belongs to the storage domain; this store owns keys in it. */
  readonly #settings: NamespacedSettings;

  constructor(db: StudioDatabase) {
    this.#settings = new AppSettings(db).namespace("retrieval");
  }

  /**
   * Reads both slots for a capability.
   *
   * A stored provider that is no longer in the registry — removed in an upgrade,
   * or written by a newer version — is ignored rather than thrown on. A user
   * whose fallback disappeared should get search that works and a settings
   * screen showing an empty slot, not a harness that will not start.
   */
  read(capability: RetrievalCapability): SlotSelection {
    const stored = this.#get(settingKey(capability, "primary"));
    const primary =
      stored !== undefined && isKnown(capability, stored)
        ? stored
        : capability === "search"
          ? DEFAULT_SEARCH_PROVIDER
          : DEFAULT_READER_PROVIDER;

    const storedFallback = this.#get(settingKey(capability, "fallback"));
    const fallback =
      storedFallback !== undefined &&
      isKnown(capability, storedFallback) &&
      storedFallback !== primary
        ? storedFallback
        : undefined;

    return { primary, fallback };
  }

  /** Records a choice. `undefined` clears the slot. */
  select(
    capability: RetrievalCapability,
    slot: RetrievalSlot,
    providerId: string | undefined,
  ): void {
    const key = settingKey(capability, slot);
    if (providerId === undefined) {
      this.#settings.clear(key);
      return;
    }
    this.#settings.set(key, providerId);
  }

  #get(key: string): string | undefined {
    return this.#settings.get(key);
  }
}
