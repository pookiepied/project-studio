import { ProviderConfigurationError, modelIdSchema } from "../../contracts/models.js";
import { AppSettings } from "../../storage/app-settings.js";
import type { StudioDatabase } from "../../storage/database.js";
import * as v from "valibot";

/** A role preference, not another capability of every language model. */
export class VoiceSettings {
  readonly #settings;

  constructor(database: StudioDatabase) {
    this.#settings = new AppSettings(database).namespace("local");
  }

  get(): string | null {
    return this.#settings.get("voice_model") ?? null;
  }

  set(modelId: string | null): void {
    if (modelId === null) {
      this.#settings.clear("voice_model");
      return;
    }
    if (!v.safeParse(modelIdSchema, modelId).success) {
      throw new ProviderConfigurationError("Choose a connected chat model for voice conversation.");
    }
    this.#settings.set("voice_model", modelId);
  }
}
