import { AppSettings, type NamespacedSettings } from "../storage/app-settings.js";
import type { StudioDatabase } from "../storage/database.js";
import { preferIsolation } from "./isolation/registry.js";

/**
 * Whether the person has turned the sandbox fence on.
 *
 * ADR 0057: the gate is the boundary, and an OS fence under it is opt-in.
 * The switch is stored here, applied to the running process through
 * `preferIsolation`, and read back by the settings page. Off is the absence
 * of a row rather than a stored "off", for the same reason an unset
 * permission mode is Ask: a fence nobody asked for is not one they declined.
 *
 * The switch is remembered on every platform, including the ones with no
 * backend to turn on. A person who sets it on Linux and opens the same data
 * directory on Windows has not changed their mind; the page there says the
 * platform has nothing to offer, and the switch waits.
 */

const KEY = "fence";

export class IsolationSettingsStore {
  readonly #settings: NamespacedSettings;

  constructor(db: StudioDatabase) {
    this.#settings = new AppSettings(db).namespace("sandbox");
  }

  /** Whether the fence is wanted. */
  read(): boolean {
    return this.#settings.get(KEY) === "on";
  }

  /** Records the choice and applies it to this process. */
  select(on: boolean): void {
    if (on) this.#settings.set(KEY, "on");
    else this.#settings.clear(KEY);
    preferIsolation(on);
  }

  /** Applies what is stored to this process, at startup. */
  apply(): void {
    preferIsolation(this.read());
  }
}
