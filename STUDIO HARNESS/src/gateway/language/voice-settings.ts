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

  /**
   * The model a voice call's background tasks run on, or null for the
   * conversation's own chat model - the default, and what tasks always used.
   * A separate choice from the voice model: the call wants a fast talker,
   * a task wants a capable worker, and one setting cannot be both.
   */
  getTask(): string | null {
    return this.#settings.get("voice_task_model") ?? null;
  }

  setTask(modelId: string | null): void {
    if (modelId === null) {
      this.#settings.clear("voice_task_model");
      return;
    }
    if (!v.safeParse(modelIdSchema, modelId).success) {
      throw new ProviderConfigurationError("Choose a connected chat model for voice tasks.");
    }
    this.#settings.set("voice_task_model", modelId);
  }
}
