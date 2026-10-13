import type { StudioDatabase } from "../storage/database.js";
import type { ExtensionKind } from "./inventory.js";

/**
 * What the user chose to switch on, and where.
 *
 * Half of the spine. `inventory.ts` knows what exists; this knows what was
 * picked. Neither knows what an MCP server or a skill is, which is the property
 * that lets a fourth kind arrive without editing either file.
 *
 * **This is scoping, not permission.** A row here decides whether an extension
 * is present at all. It never authorizes a call - everything present still
 * passes the kernel, per call. Enabling can only subtract from what the model
 * can reach; it can never add to what the model may do.
 *
 * ## The three scopes
 *
 * ```
 *   conversation   an override for one conversation
 *   project        the decision for a project
 *   global         the user's default, inherited by everything
 * ```
 *
 * **Resolution is narrowest-first**, and absence at a scope means "no decision
 * here" rather than "off". A conversation with no decision falls to its
 * project; a project with no decision falls to the global default; an absent
 * global default is off.
 *
 * That is what lets a quick conversation with no project work with no setup at
 * all, which is the case this product is built around. The alternative - every
 * scope starting empty - makes the fastest path the one demanding the most
 * configuration.
 */

/** Which of the three scopes a decision was made at. */
export type ScopeKind = "global" | "project" | "conversation";

/**
 * A scope, as a pair.
 *
 * The global scope has no id and carries the empty string, a value neither
 * other scope can produce because project and conversation ids are never
 * empty. A nullable column inside a primary key is a shape SQLite will let you
 * write and then quietly disagree with you about.
 */
export interface Scope {
  readonly kind: ScopeKind;
  readonly id: string;
}

export const GLOBAL_SCOPE: Scope = { kind: "global", id: "" };

export function projectScope(projectId: string): Scope {
  return { kind: "project", id: projectId };
}

export function conversationScope(conversationId: string): Scope {
  return { kind: "conversation", id: conversationId };
}

export interface SelectionKey {
  readonly kind: ExtensionKind;
  readonly extensionId: string;
  readonly scope: Scope;
}

/**
 * Where an extension is asked about.
 *
 * A conversation may or may not belong to a project, and that is the only
 * variation the resolution has to handle: the chain is built from whichever
 * of the two are present, and always ends at the global default.
 */
export interface ResolutionContext {
  readonly conversationId?: string;
  readonly projectId?: string;
}

/** An answer, and the scope that produced it, so a UI can say why. */
export interface Resolution {
  readonly enabled: boolean;
  /** `undefined` when nothing anywhere had an opinion, which resolves to off. */
  readonly decidedAt?: ScopeKind;
}

export class ExtensionSelectionStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /**
   * The decision recorded at exactly one scope, or `undefined` for none.
   *
   * Deliberately not a boolean: at a single scope, "never decided" and
   * "switched off" are genuinely different, because the first inherits and the
   * second does not. That distinction is the whole mechanism, so it may not be
   * flattened here the way the old project-only store flattened it.
   */
  decisionAt(key: SelectionKey): boolean | undefined {
    const row = this.#db
      .prepare(
        `SELECT enabled FROM extension_scope
          WHERE kind = ? AND extension_id = ? AND scope_kind = ? AND scope_id = ?`,
      )
      .get(key.kind, key.extensionId, key.scope.kind, key.scope.id) as
      | { enabled: number }
      | undefined;

    return row === undefined ? undefined : row.enabled === 1;
  }

  /**
   * The answer that actually applies, and where it came from.
   *
   * Narrowest-first. The chain skips a scope that is not present rather than
   * inventing an id for it, so a conversation outside a project asks two
   * questions instead of three.
   */
  resolve(
    kind: ExtensionKind,
    extensionId: string,
    context: ResolutionContext,
  ): Resolution {
    for (const scope of this.#chain(context)) {
      const decision = this.decisionAt({ kind, extensionId, scope });
      if (decision !== undefined) {
        return { enabled: decision, decidedAt: scope.kind };
      }
    }
    return { enabled: false };
  }

  /**
   * Every extension of one kind that is on in this context.
   *
   * Resolved per extension rather than read from one scope, because an
   * extension is on here if ANY scope in the chain says so and no narrower one
   * overrides it - a question no single query answers. The candidate set is
   * every extension mentioned anywhere in the chain, since an extension nobody
   * has ever decided about is off and cannot appear.
   */
  enabledIds(kind: ExtensionKind, context: ResolutionContext): readonly string[] {
    const scopes = this.#chain(context);
    const placeholders = scopes.map(() => "(scope_kind = ? AND scope_id = ?)").join(" OR ");
    const rows = this.#db
      .prepare(
        `SELECT DISTINCT extension_id FROM extension_scope
          WHERE kind = ? AND (${placeholders})
          ORDER BY extension_id`,
      )
      .all(kind, ...scopes.flatMap((scope) => [scope.kind, scope.id])) as {
      extension_id: string;
    }[];

    return rows
      .map((row) => row.extension_id)
      .filter((extensionId) => this.resolve(kind, extensionId, context).enabled);
  }

  /**
   * Records a decision.
   *
   * An explicit off is written rather than deleted, and here that is load
   * bearing rather than merely tidy: at a narrow scope an explicit off is what
   * overrides a wider on. Deleting it would restore the inherited answer,
   * which is a different thing than the user asked for.
   */
  set(key: SelectionKey, enabled: boolean): void {
    this.#db
      .prepare(
        `INSERT INTO extension_scope
           (kind, extension_id, scope_kind, scope_id, enabled, decided_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (kind, extension_id, scope_kind, scope_id)
         DO UPDATE SET enabled = excluded.enabled, decided_at = excluded.decided_at`,
      )
      .run(
        key.kind,
        key.extensionId,
        key.scope.kind,
        key.scope.id,
        enabled ? 1 : 0,
        Date.now(),
      );
  }

  /**
   * Removes a decision at one scope, so the wider scope applies again.
   *
   * The counterpart to `set`, and not the same as setting it off: this is
   * "stop having an opinion here", which is how a project or conversation goes
   * back to inheriting. A UI that offers on and off but no way back to
   * inherited traps the user at the narrow scope forever.
   */
  clear(key: SelectionKey): void {
    this.#db
      .prepare(
        `DELETE FROM extension_scope
          WHERE kind = ? AND extension_id = ? AND scope_kind = ? AND scope_id = ?`,
      )
      .run(key.kind, key.extensionId, key.scope.kind, key.scope.id);
  }

  /**
   * Forgets an extension everywhere, for when it is uninstalled.
   *
   * Across every scope, because the thing being selected no longer exists.
   * Leaving the rows behind would mean reinstalling something later silently
   * switched it back on somewhere the user has not looked since - a decision
   * they made about a different installation.
   *
   * Selections are not grants and this is not a revoke. Grants are revoked
   * separately, by the grant store, which is the only thing allowed to decide
   * what an approval meant.
   */
  forget(kind: ExtensionKind, extensionId: string): number {
    const result = this.#db
      .prepare(`DELETE FROM extension_scope WHERE kind = ? AND extension_id = ?`)
      .run(kind, extensionId);

    return Number(result.changes);
  }

  /**
   * Destroys every conversation-scoped decision for one conversation, for
   * permanent deletion. A narrower `clear` would hand the conversation back
   * to its project scope, but a deleted conversation inherits nothing - its
   * overrides go with it. Called only from `conversations/purge.ts`, after
   * the journal.
   */
  clearConversation(conversationId: string): number {
    const result = this.#db
      .prepare(
        `DELETE FROM extension_scope WHERE scope_kind = 'conversation' AND scope_id = ?`,
      )
      .run(conversationId);

    return Number(result.changes);
  }

  /**
   * Carries one conversation's scoped extension decisions to a fork.
   *
   * An explicit off travels exactly like an on: at a narrow scope an off is
   * what overrides a wider on, and dropping it would silently switch the
   * fork's extensions back on. Called only from `conversations/fork.ts`,
   * after the fork's index row.
   */
  duplicateConversation(sourceId: string, targetId: string): number {
    const result = this.#db
      .prepare(
        `INSERT INTO extension_scope
           (kind, extension_id, scope_kind, scope_id, enabled, decided_at)
         SELECT kind, extension_id, scope_kind, ?, enabled, decided_at
           FROM extension_scope
          WHERE scope_kind = 'conversation' AND scope_id = ?`,
      )
      .run(targetId, sourceId);

    return Number(result.changes);
  }

  /** Narrowest first, skipping whichever scopes this context does not have. */
  #chain(context: ResolutionContext): readonly Scope[] {
    const scopes: Scope[] = [];
    if (context.conversationId !== undefined) {
      scopes.push(conversationScope(context.conversationId));
    }
    if (context.projectId !== undefined) scopes.push(projectScope(context.projectId));
    scopes.push(GLOBAL_SCOPE);
    return scopes;
  }
}
