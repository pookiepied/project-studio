import { ProviderConfigurationError } from "../../contracts/models.js";
import type { StudioDatabase } from "../../storage/database.js";

/**
 * What the provider itself said it serves, learned by probing.
 *
 * Task 38 found the shipped catalog offering `ai21/jamba-large-1.7` while
 * OpenRouter answered `404: No endpoints found` for it - and measured that
 * OpenRouter's own model list does not name the model at all (415 listed, the
 * dead id absent). So the honest fix is to record what the provider's list
 * names after each successful probe and let the catalog mark what the list
 * omits: the provider gets to say what it serves, one request, no guessing.
 *
 * The state is advisory and per connection. Absence of a row means "never
 * probed", which must never read as "everything unavailable" - a connection
 * nobody has checked yet offers everything its catalog claims. The set also
 * goes stale as the provider changes its mind; the next probe corrects it.
 *
 * Language connections only: the image catalog's ids are not faithfully
 * enumerated by the same list endpoint (measured: several listed image
 * models are absent from OpenRouter's `/models`), so marking image rows from
 * it would mark models that work.
 */

export interface ProbeState {
  /** The model ids the provider's own list named, verbatim. */
  readonly servedIds: ReadonlySet<string>;
  readonly probedAt: number;
}

export interface ProbeStateStoreOptions {
  readonly db: StudioDatabase;
}

export class ProbeStateStore {
  readonly #db: StudioDatabase;

  constructor(options: ProbeStateStoreOptions) {
    this.#db = options.db;
  }

  /** Every connection's last learned set. Connections never probed are absent. */
  readAll(): ReadonlyMap<string, ProbeState> {
    let rows: readonly Record<string, unknown>[];
    try {
      rows = this.#db
        .prepare(
          `SELECT connection_id, served_ids, probed_at
              FROM provider_probe_state`,
        )
        .all();
    } catch {
      throw new ProviderConfigurationError("Provider probe state could not be read.");
    }

    const states = new Map<string, ProbeState>();
    for (const row of rows) {
      const connectionId = row.connection_id;
      const raw = row.served_ids;
      const probedAt = row.probed_at;
      if (
        typeof connectionId !== "string" ||
        typeof raw !== "string" ||
        typeof probedAt !== "number"
      ) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        if (!Array.isArray(parsed)) continue;
        states.set(connectionId, {
          servedIds: new Set(parsed.filter((id): id is string => typeof id === "string")),
          probedAt,
        });
      } catch {
        continue;
      }
    }
    return states;
  }

  /** Records what one probe learned, replacing whatever the last one said. */
  record(connectionId: string, servedIds: readonly string[], probedAt: number): void {
    try {
      this.#db
        .prepare(
          `INSERT INTO provider_probe_state (connection_id, served_ids, probed_at)
           VALUES (?, ?, ?)
           ON CONFLICT(connection_id) DO UPDATE SET
                served_ids = excluded.served_ids,
                probed_at = excluded.probed_at`,
        )
        .run(connectionId, JSON.stringify(servedIds), probedAt);
    } catch {
      throw new ProviderConfigurationError("Provider probe state could not be saved.");
    }
  }
}
