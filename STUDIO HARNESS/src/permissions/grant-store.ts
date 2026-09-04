import {
  capabilityKey,
  type CapabilityId,
  type ExecutionScope,
} from "../contracts/capabilities.js";
import { createStudioUuid } from "../identity/uuid.js";
import type { StudioDatabase } from "../storage/database.js";
import { storageErrorFrom } from "../storage/errors.js";
import { matchesResource, patternSpecificity, type ResourceKind } from "./matcher.js";
import type { GrantDuration } from "./policy.js";

/**
 * Stored user approvals.
 *
 * Grants are the only part of the permission system a user can change, which
 * makes their being listable and revocable a requirement rather than a feature:
 * an approval the user cannot see or take back is worse than never having
 * asked.
 *
 * Only `allow` is ever stored. A denial is the default for everything
 * unapproved, so persisting one would add nothing except a second way for the
 * two to disagree.
 */

export interface PermissionGrant {
  readonly id: string;
  readonly capabilityKey: string;
  readonly agentId: string;
  /** Set for a conversation-scoped grant; null for one that persists. */
  readonly conversationId: string | undefined;
  readonly projectId: string | undefined;
  /**
   * What the approval was narrowed to — `src/**`, `git:log`. Undefined means
   * the whole capability, which is what every grant meant before resources
   * existed.
  */
  readonly resourcePattern: string | undefined;
  /** The definition the user saw when this approval was given. */
  readonly definitionHash: string | undefined;
  readonly grantedAt: number;
}

interface GrantRow {
  id: string;
  capability_key: string;
  agent_id: string;
  conversation_id: string | null;
  project_id: string | null;
  resource_pattern: string | null;
  definition_hash: string | null;
  granted_at: number;
}

const COLUMNS = `id, capability_key, agent_id, conversation_id, project_id,
                  resource_pattern, definition_hash, granted_at`;

function toGrant(row: GrantRow): PermissionGrant {
  return {
    id: row.id,
    capabilityKey: row.capability_key,
    agentId: row.agent_id,
    conversationId: row.conversation_id ?? undefined,
    projectId: row.project_id ?? undefined,
    resourcePattern: row.resource_pattern ?? undefined,
    definitionHash: row.definition_hash ?? undefined,
    grantedAt: row.granted_at,
  };
}

export class PermissionGrantStore {
  readonly #db: StudioDatabase;

  constructor(db: StudioDatabase) {
    this.#db = db;
  }

  /**
   * Finds the grant covering a call.
   *
   * A conversation-scoped grant is checked first: it is the narrower of the
   * two, and preferring the broader one would report a persistent approval
   * where the user only approved this conversation.
   *
   * **A grant belongs to the project it was approved in.** `project_id` was
   * written on every row from the start and never read, so "always allow
   * `git:push`" approved in one repository silently applied in every other one.
   * Path grants hid it, because the stored pattern is an absolute path under
   * the old root; command grants had no such boundary at all.
   *
   * A row with no project applies anywhere, which mirrors how a row with no
   * conversation applies to any conversation. Nothing in the application writes
   * one — `scope.projectId` is always set — so this covers fixtures rather than
   * being a route around the rule.
   */
  find(
    id: CapabilityId,
    scope: ExecutionScope,
    resource?: string,
    kind: ResourceKind = "path",
    definitionHash?: string,
  ): PermissionGrant | undefined {
    const key = capabilityKey(id);

    const rows = this.#db
      .prepare(
        `SELECT ${COLUMNS}
           FROM permission_grant
          WHERE capability_key = ?
            AND agent_id = ?
            AND revoked_at IS NULL
            AND (conversation_id = ? OR conversation_id IS NULL)
            AND (project_id = ? OR project_id IS NULL)`,
      )
      .all(
        key,
        scope.agentId,
        scope.conversationId,
        scope.projectId ?? null,
      ) as unknown as GrantRow[];

    // Pattern matching happens here rather than in SQL: SQLite's GLOB cannot
    // express the `*` / `**` distinction, and approximating it in SQL would
    // make the stored rule and the enforced rule two different things.
    // A definition hash is another part of the approval: a connected tool with
    // the same name but a different definition is not the thing the user saw.
    const applicable = rows
      .filter(
        (row) =>
          matchesResource(row.resource_pattern ?? undefined, resource, kind) &&
          (definitionHash === undefined || row.definition_hash === definitionHash),
      )
      .sort((left, right) => {
        // A conversation-scoped grant is narrower than a standing one, and a
        // specific pattern is narrower than a wildcard. Preferring the broader
        // match would report a permission the user never gave.
        const byScope =
          Number(left.conversation_id === null) - Number(right.conversation_id === null);
        if (byScope !== 0) return byScope;

        // Same reasoning one level out: a grant tied to this project is
        // narrower than one tied to no project.
        const byProject =
          Number(left.project_id === null) - Number(right.project_id === null);
        if (byProject !== 0) return byProject;

        return (
          patternSpecificity(right.resource_pattern ?? undefined) -
          patternSpecificity(left.resource_pattern ?? undefined)
        );
      });

    const row = applicable[0];
    return row ? toGrant(row) : undefined;
  }

  /**
   * Records an approval.
   *
   * `once` stores nothing: it authorizes the call in front of the user and
   * must not silently become a standing permission.
   */
  grant(
    id: CapabilityId,
    scope: ExecutionScope,
    duration: GrantDuration,
    resourcePattern?: string,
    definitionHash?: string,
  ): PermissionGrant | undefined {
    if (duration === "once") return undefined;

    const key = capabilityKey(id);
    const conversationId = duration === "conversation" ? scope.conversationId : null;
    const grant: GrantRow = {
      id: createStudioUuid(),
      capability_key: key,
      agent_id: scope.agentId,
      conversation_id: conversationId,
      project_id: scope.projectId ?? null,
      resource_pattern: resourcePattern ?? null,
      definition_hash: definitionHash ?? null,
      granted_at: Date.now(),
    };

    const existing = this.#findExact(grant);
    if (existing) return this.#refreshDefinition(existing, definitionHash, grant.granted_at);

    try {
      this.#db
        .prepare(
          `INSERT INTO permission_grant
                  (id, capability_key, agent_id, conversation_id, project_id,
                    resource_pattern, definition_hash, verdict, granted_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, 'allow', ?)`,
        )
        .run(
          grant.id,
          grant.capability_key,
          grant.agent_id,
          grant.conversation_id,
          grant.project_id,
          grant.resource_pattern,
          grant.definition_hash,
          grant.granted_at,
        );
    } catch (error) {
      // The unique index makes a repeated approval a conflict. That is the
      // user approving something they already approved, which is a no-op. A
      // changed definition is different: the approval is new, so its hash must
      // replace the old one rather than leaving the stale grant in place.
      const existing = this.#findExact(grant);
      if (existing) return this.#refreshDefinition(existing, definitionHash, grant.granted_at);
      throw storageErrorFrom(error);
    }

    return toGrant(grant);
  }

  /** Everything the user could revoke, newest first. */
  list(agentId?: string): readonly PermissionGrant[] {
    const rows = (
      agentId === undefined
        ? this.#db
            .prepare(
              `SELECT ${COLUMNS}
                 FROM permission_grant WHERE revoked_at IS NULL
                ORDER BY granted_at DESC`,
            )
            .all()
        : this.#db
            .prepare(
              `SELECT ${COLUMNS}
                 FROM permission_grant WHERE revoked_at IS NULL AND agent_id = ?
                ORDER BY granted_at DESC`,
            )
            .all(agentId)
    ) as unknown as GrantRow[];

    return rows.map(toGrant);
  }

  /**
   * Revokes by marking rather than deleting, so the audit trail survives the
   * user changing their mind.
   */
  revoke(grantId: string): boolean {
    const result = this.#db
      .prepare(
        "UPDATE permission_grant SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      )
      .run(Date.now(), grantId);
    return Number(result.changes) > 0;
  }

  /**
   * Revokes every grant belonging to one namespace.
   *
   * The operation that actually happens when an extension goes away. A server
   * removed, uninstalled, or edited in the way it is reached takes its
   * approvals with it: the user approved `mcp:blender/render` after reading
   * what that tool said it did, and a different server answering to the same
   * name is a different tool wearing an approval it was never given.
   *
   * Matched by exact prefix rather than `LIKE`, because a namespace is
   * user-influenced text and `%` and `_` are wildcards. `mcp:a_b` written as a
   * `LIKE` pattern also matches `mcp:axb`, which would revoke a server the user
   * never touched — a quiet failure in the safe direction today, and the wrong
   * habit to leave in a query that one day revokes less than it should.
   *
   * **Marks rather than deletes**, like every other revoke here. Reinstalling
   * something must re-ask rather than silently inherit, and the record of what
   * was once approved is the thing that makes that reviewable.
   *
   * Deliberately not the same call as removing the tools. `CallGate.unregister`
   * takes a capability away; this takes the approval away. They happen together
   * and mean different things, and a single call that did both would make
   * "unregistering is not revoking" impossible to say.
   */
  revokeNamespace(namespace: string): number {
    const prefix = `${namespace}/`;
    const result = this.#db
      .prepare(
        `UPDATE permission_grant SET revoked_at = ?
          WHERE substr(capability_key, 1, ?) = ? AND revoked_at IS NULL`,
      )
      .run(Date.now(), prefix.length, prefix);
    return Number(result.changes);
  }

  /** Drops conversation-scoped grants when a conversation ends. */
  revokeConversation(conversationId: string): number {
    const result = this.#db
      .prepare(
        "UPDATE permission_grant SET revoked_at = ? WHERE conversation_id = ? AND revoked_at IS NULL",
      )
      .run(Date.now(), conversationId);
    return Number(result.changes);
  }

  /**
   * Destroys every grant scoped to one conversation, for permanent deletion.
   *
   * Distinct from `revokeConversation`, which marks rows so the audit trail
   * survives a user changing their mind. A deleted conversation has no trail
   * to keep: a revoked row would still be keyed to an id nothing addresses,
   * and the purge proof is that no row keyed to the id exists anywhere
   * afterwards. Called only from `conversations/purge.ts`, after the journal.
   */
  deleteConversation(conversationId: string): number {
    const result = this.#db
      .prepare("DELETE FROM permission_grant WHERE conversation_id = ?")
      .run(conversationId);
    return Number(result.changes);
  }

  #findExact(grant: GrantRow): GrantRow | undefined {
    const row = this.#db
      .prepare(
        `SELECT ${COLUMNS}
           FROM permission_grant
          WHERE capability_key = ?
            AND agent_id = ?
            AND IFNULL(conversation_id, '') = IFNULL(?, '')
            AND IFNULL(project_id, '') = IFNULL(?, '')
            AND IFNULL(resource_pattern, '') = IFNULL(?, '')
            AND revoked_at IS NULL`,
      )
      .get(
        grant.capability_key,
        grant.agent_id,
        grant.conversation_id,
        grant.project_id,
        grant.resource_pattern,
      ) as unknown;

    return row === undefined ? undefined : (row as GrantRow);
  }

  #refreshDefinition(
    row: GrantRow,
    definitionHash: string | undefined,
    grantedAt: number,
  ): PermissionGrant {
    if (definitionHash !== undefined && row.definition_hash !== definitionHash) {
      this.#db
        .prepare("UPDATE permission_grant SET definition_hash = ?, granted_at = ? WHERE id = ?")
        .run(definitionHash, grantedAt, row.id);
      row.definition_hash = definitionHash;
      row.granted_at = grantedAt;
    }

    return toGrant(row);
  }
}
