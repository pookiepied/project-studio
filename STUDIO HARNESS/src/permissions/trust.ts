import { resolve } from "node:path";

import type { CapabilityDescriptor } from "../contracts/capabilities.js";
import type { StudioDatabase } from "../storage/database.js";
import { storageErrorFrom } from "../storage/errors.js";
import type { ExecutionMode } from "./mode.js";

/**
 * Whether the user has said they trust a folder.
 *
 * A precondition, evaluated before policy and before grants. Opening a
 * repository someone sent you is the ordinary way a machine ends up running
 * instructions its owner never wrote — through a `.studio` config, a git hook,
 * a build script, or a file whose contents the model reads as direction. None
 * of that is stopped by asking permission per call, because the per-call
 * question is about a capability and the actual question is about the folder.
 *
 * So trust is answered **once, deliberately, about the folder**, and an
 * untrusted folder is refused rather than asked about. Asking would let a model
 * that keeps trying eventually collect the same authority one click at a time,
 * which is precisely what a single explicit decision prevents.
 */

export type TrustDecision = "trusted" | "untrusted" | "undecided";

/**
 * Paths are compared case-insensitively on Windows, where `C:\Work` and
 * `c:\work` are the same folder and a case-sensitive key would let the same
 * project be trusted twice — or, worse, be untrusted under a spelling the user
 * already approved.
 */
const CASE_INSENSITIVE = process.platform === "win32";

export function trustKey(root: string): string {
  const absolute = resolve(root);
  return CASE_INSENSITIVE ? absolute.toLowerCase() : absolute;
}

interface TrustRow {
  trusted: number;
  decided_at: number;
}

export class WorkspaceTrustStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  decision(root: string | undefined): TrustDecision {
    if (root === undefined) return "undecided";

    try {
      const row = this.#db.handle
        .prepare("SELECT trusted, decided_at FROM workspace_trust WHERE root = ?")
        .get(trustKey(root)) as TrustRow | undefined;

      if (row === undefined) return "undecided";
      return row.trusted === 1 ? "trusted" : "untrusted";
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  /**
   * Records the user's answer.
   *
   * A refusal is stored rather than the row deleted, so "declined" stays
   * distinguishable from "never asked". Re-prompting someone who already said
   * no is how a dialog teaches people to click through it.
   */
  set(root: string, trusted: boolean): void {
    try {
      this.#db.handle
        .prepare(
          `INSERT INTO workspace_trust (root, trusted, decided_at)
                VALUES (?, ?, ?)
           ON CONFLICT (root) DO UPDATE
                   SET trusted = excluded.trusted, decided_at = excluded.decided_at`,
        )
        .run(trustKey(root), trusted ? 1 : 0, Date.now());
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }

  list(): readonly { root: string; trusted: boolean; decidedAt: number }[] {
    try {
      const rows = this.#db.handle
        .prepare("SELECT root, trusted, decided_at FROM workspace_trust ORDER BY root")
        .all() as { root: string; trusted: number; decided_at: number }[];

      return rows.map((row) => ({
        root: row.root,
        trusted: row.trusted === 1,
        decidedAt: row.decided_at,
      }));
    } catch (error) {
      throw storageErrorFrom(error);
    }
  }
}

/**
 * What an untrusted folder still allows.
 *
 * The answer is `safeUntrusted` in `contracts/effects.ts`, and it is only
 * `read`. Re-exported here so this module still reads as the whole story of
 * trust, while the rule itself stays in the one table every other reader uses.
 */
export { allowedWhileUntrusted } from "../contracts/effects.js";

/**
 * The trust and mode state a decision is made under.
 *
 * Injected, like the approver, so the same policy runs identically in the app,
 * headless, and in a test.
 */
export interface ExecutionPosture {
  mode(): ExecutionMode;
  trust(root: string | undefined): TrustDecision;
}

/**
 * The posture used when none is supplied.
 *
 * Named rather than inlined, because what it does is skip a safeguard: it
 * treats every folder as trusted and every `ask` as an `ask`. That is the
 * behaviour the harness had before trust existed, which makes it the right
 * default for a test or a fixture and the wrong one for the application. The
 * application wires a real posture; see `T-12`.
 */
export const UNGATED_POSTURE: ExecutionPosture = {
  mode: () => "manual",
  trust: () => "trusted",
};

export function posture(input: {
  readonly mode: () => ExecutionMode;
  readonly trust: WorkspaceTrustStore;
}): ExecutionPosture {
  return {
    mode: input.mode,
    trust: (root) => input.trust.decision(root),
  };
}
