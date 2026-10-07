/**
 * A permission question the harness is holding, and the answer a person
 * gives it.
 */

import { isRecord } from '@/lib/guards'
import { finiteNumber, listOf, nullableTextOrAbsent, oneOf, text } from './guards'

/*
 * Mirrored from `GET /api/permissions/pending`: one element of what
 * `broker.list()` answers, which is a row of the durable store
 * (`STUDIO HARNESS/src/application/approval-broker.ts`). A pending row is a
 * question the permission kernel raised and nobody has answered yet - the run
 * that asked is parked until it is answered or cancelled, and the list is the
 * one source that survives a harness restart, which is why the webview polls
 * it instead of reading the conversation stream (the stream's chunk union is
 * closed; see Task 47's report, section 6).
 *
 * Only the fields the prompt renders are carried. The request's full
 * descriptor - provenance, input schema, idempotence - stays on the wire side;
 * a parser that rebuilt all of it would have to refuse rows it could have
 * shown, and a parked run is the one state this file must not make harder to
 * see.
 */

/** The verdict half of an answer; the harness accepts nothing else. */
export type ApprovalVerdict = 'allow' | 'deny'

/**
 * How long an allow lasts. `always` outlives the conversation: a real grant
 * in the harness's store, which is why the prompt that offers it treats it as
 * the heavier choice.
 */
export type GrantDuration = 'once' | 'conversation' | 'always'

export interface ApprovalAnswer {
  readonly verdict: ApprovalVerdict
  readonly duration: GrantDuration
  /**
   * Which rung of the kernel's own ladder the grant is stored against.
   *
   * Omitted means the narrowest rung the kernel offered, which for a file is
   * that one file. That default is right for "just once" and wrong for the
   * two lasting answers: a grant pinned to one file makes "this conversation"
   * ask again about the next file, which is not what the words say. Only a
   * rung the kernel actually offered may be sent; anything else is narrowed
   * server-side and reported as an approver bug.
   */
  readonly scopeId?: string
}

/** One rung of the scope ladder the kernel offered; rendered, never invented here. */
export interface ApprovalScopeOption {
  readonly id: string
  readonly label: string
  readonly detail: string
  /**
   * The rule this rung would store, when the kernel sent one.
   *
   * Read for one reason: the `this-folder` rung's pattern is the conversation's
   * workspace, which is what turns an absolute resource into the
   * workspace-relative path the question shows. Optional because it is the
   * kernel's own field and a row without it must still render - the sentence
   * falls back to the file's name.
   */
  readonly pattern: string | null
}

/** Why the kernel asked. `policy` asks survive every mode and are worth explaining. */
export type DecisionSourceWire = 'policy' | 'grant' | 'default'

export interface PendingApprovalRecord {
  readonly id: string
  readonly createdAt: number
  readonly capabilityNamespace: string
  readonly capabilityName: string
  /** The harness's own title for the capability, e.g. "Write file". */
  readonly capabilityTitle: string
  /** What the call touches - a resolved path, or `shell:npm`. Null when the call is not narrowable. */
  readonly resource: string | null
  /** The conversation whose run raised the question, bare: `cnv_x`, not `conversation:cnv_x`. */
  readonly conversationId: string | null
  /**
   * The agent whose call raised the question - `general`, `explore` - or null
   * when it was the conversation agent's own. S5.4's attribution: a delegate
   * asks under its own name (ADR 0058), so the card can say who is asking,
   * and a person answering knows which agent the grant will be keyed to.
   */
  readonly agentId: string | null
  /** The scope ladder, narrowest first, exactly as the kernel offered it. */
  readonly scopes: readonly ApprovalScopeOption[]
  readonly source: DecisionSourceWire
  /** The kernel's short sentence for why this needs a person. */
  readonly reason: string
}

export function parsePendingApproval(value: unknown): PendingApprovalRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const createdAt = finiteNumber(value['createdAt'])
  if (id === null || createdAt === null) return null

  // Everything the prompt renders lives under `request` and `decision`.
  const request = value['request']
  const decision = value['decision']
  if (!isRecord(request) || !isRecord(decision)) return null

  const capability = request['capability']
  const scope = request['scope']
  if (!isRecord(capability) || !isRecord(scope)) return null

  const capabilityId = capability['id']
  if (!isRecord(capabilityId)) return null
  const capabilityNamespace = text(capabilityId['namespace'])
  const capabilityName = text(capabilityId['name'])
  const capabilityTitle = text(capability['title'])
  if (capabilityNamespace === null || capabilityName === null || capabilityTitle === null) {
    return null
  }

  const resource = nullableTextOrAbsent(request['resource'])
  const conversationId = nullableTextOrAbsent(scope['conversationId'])
  // The conversation agent's frames carry no acting agent; `studio` itself
  // never arrives here, so present means a delegate. A non-string is absent.
  const agentId = nullableTextOrAbsent(scope['agentId'])

  const scopes = listOf(parseApprovalScope, request['scopes'])
  const source = oneOf<DecisionSourceWire>(['policy', 'grant', 'default'], decision['source'])
  const reason = text(decision['reason'])
  if (
    scopes === null ||
    source === null ||
    reason === null ||
    !resource.ok ||
    !conversationId.ok ||
    !agentId.ok
  ) {
    return null
  }

  return {
    id,
    createdAt,
    capabilityNamespace,
    capabilityName,
    capabilityTitle,
    resource: resource.value,
    conversationId: conversationId.value,
    agentId: agentId.value,
    scopes,
    source,
    reason,
  }
}

export function parseApprovalScope(value: unknown): ApprovalScopeOption | null {
  if (!isRecord(value)) return null
  const id = text(value['id'])
  const label = text(value['label'])
  const detail = text(value['detail'])
  if (id === null || label === null || detail === null) return null
  return { id, label, detail, pattern: text(value['pattern']) }
}

export function parsePendingApprovals(
  value: unknown,
): readonly PendingApprovalRecord[] | null {
  return listOf(parsePendingApproval, value)
}
