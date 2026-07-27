import { randomUUID } from "node:crypto";

import {
  capabilityKey,
  type CapabilityId,
  type ExecutionScope,
} from "../contracts/capabilities.js";
import type { StudioDatabase } from "../storage/database.js";
import { storageErrorFrom } from "../storage/errors.js";
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
  readonly grantedAt: number;
}

interface GrantRow {
  id: string;
  capability_key: string;
  agent_id: string;
  conversation_id: string | null;
  project_id: string | null;
  granted_at: number;
}

function toGrant(row: GrantRow): PermissionGrant {
  return {
    id: row.id,
    capabilityKey: row.capability_key,
    agentId: row.agent_id,
    conversationId: row.conversation_id ?? undefined,
    projectId: row.project_id ?? undefined,
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
   */
  find(id: CapabilityId, scope: ExecutionScope): PermissionGrant | undefined {
    const key = capabilityKey(id);

    const row = this.#db.handle
      .prepare(
        `SELECT id, capability_key, agent_id, conversation_id, project_id, granted_at
           FROM permission_grant
          WHERE capability_key = ?
            AND agent_id = ?
            AND revoked_at IS NULL
            AND (conversation_id = ? OR conversation_id IS NULL)
          ORDER BY conversation_id IS NULL
          LIMIT 1`,
      )
      .get(key, scope.agentId, scope.conversationId) as unknown as
      | GrantRow
      | undefined;

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
  ): PermissionGrant | undefined {
    if (duration === "once") return undefined;

    const key = capabilityKey(id);
    const conversationId = duration === "conversation" ? scope.conversationId : null;
    const grant: GrantRow = {
      id: randomUUID(),
      capability_key: key,
      agent_id: scope.agentId,
      conversation_id: conversationId,
      project_id: scope.projectId ?? null,
      granted_at: Date.now(),
    };

    try {
      this.#db.handle
        .prepare(
          `INSERT INTO permission_grant
                  (id, capability_key, agent_id, conversation_id, project_id, verdict, granted_at)
                VALUES (?, ?, ?, ?, ?, 'allow', ?)`,
        )
        .run(
          grant.id,
          grant.capability_key,
          grant.agent_id,
          grant.conversation_id,
          grant.project_id,
          grant.granted_at,
        );
    } catch (error) {
      // The unique index makes a repeated approval a conflict. That is the
      // user approving something they already approved, which is a no-op, not
      // a failure to surface.
      const existing = this.find(id, scope);
      if (existing) return existing;
      throw storageErrorFrom(error);
    }

    return toGrant(grant);
  }

  /** Everything the user could revoke, newest first. */
  list(agentId?: string): readonly PermissionGrant[] {
    const rows = (
      agentId === undefined
        ? this.#db.handle
            .prepare(
              `SELECT id, capability_key, agent_id, conversation_id, project_id, granted_at
                 FROM permission_grant WHERE revoked_at IS NULL
                ORDER BY granted_at DESC`,
            )
            .all()
        : this.#db.handle
            .prepare(
              `SELECT id, capability_key, agent_id, conversation_id, project_id, granted_at
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
    const result = this.#db.handle
      .prepare(
        "UPDATE permission_grant SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
      )
      .run(Date.now(), grantId);
    return Number(result.changes) > 0;
  }

  /** Drops conversation-scoped grants when a conversation ends. */
  revokeConversation(conversationId: string): number {
    const result = this.#db.handle
      .prepare(
        "UPDATE permission_grant SET revoked_at = ? WHERE conversation_id = ? AND revoked_at IS NULL",
      )
      .run(Date.now(), conversationId);
    return Number(result.changes);
  }
}
