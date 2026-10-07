/**
 * The plan a conversation carries: its items and their states.
 */

import { isRecord } from '@/lib/guards'
import type { ArtifactStatus } from '@/domain/artifacts/types'
import { finiteNumber, listOf, text } from './guards'

/*
 * Mirrored from `GET /api/plans/:conversationId`: one conversation's plan as
 * `PlanItemStore.list()` answers it
 * (`STUDIO HARNESS/src/plan/plan-items.ts`). The plan is the conversation's
 * standing intention - the model writes items into it, the person ticks them,
 * and this panel reads the rows rather than the transcript, so nothing is
 * lost when the message that announced the plan scrolls away.
 *
 * Statuses are the artifact vocabulary (`domain/artifacts/types`), the same
 * five that vocabulary chose over eleven synonyms. A second vocabulary for
 * the same question is how the drift starts.
 *
 * `damaged` is a state, not an error: rows that cannot be trusted make the
 * whole plan damaged, and the panel offers to clear it. An empty plan and an
 * unreadable plan are different facts, and the person is shown which one
 * they are looking at.
 */

export interface PlanItemRecord {
  readonly id: string
  readonly text: string
  readonly status: ArtifactStatus
  /** First-seen order. The panel renders in this order and nothing resorts it. */
  readonly position: number
  /**
   * Who last touched the item: the conversation agent's write, the person's
   * tick, or a delegate's write named as `agent:<agentName>` (S5.2's writer
   * dimension). The panel reads the kind and, for a delegate, the name.
   */
  readonly updatedBy: 'model' | 'person' | `agent:${string}`
  readonly updatedAt: number
}

export interface PlanSnapshot {
  readonly conversationId: string
  readonly items: readonly PlanItemRecord[]
  readonly damaged: boolean
}

export function parsePlanSnapshot(value: unknown): PlanSnapshot | null {
  if (!isRecord(value)) return null

  const conversationId = text(value['conversationId'])
  const damaged = value['damaged']
  if (conversationId === null || typeof damaged !== 'boolean') return null

  const items = listOf(parsePlanItem, value['items'])
  if (items === null) return null

  return { conversationId, items, damaged }
}

export function parsePlanItem(value: unknown): PlanItemRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const itemText = text(value['text'])
  const status = PLAN_STATUS.get(value['status'])
  const position = finiteNumber(value['position'])
  const updatedAt = finiteNumber(value['updatedAt'])
  // The writer dimension, parsed rather than trusted: `model` and `person`
  // are exact, and a delegate's write arrives as `agent:<agentName>` — the
  // same string the store stores, with the non-empty-name rule mirrored so
  // a malformed value fails the row instead of rendering as a writer.
  const rawWriter = value['updatedBy']
  const updatedBy =
    rawWriter === 'model' || rawWriter === 'person'
      ? rawWriter
      : typeof rawWriter === 'string' &&
          rawWriter.startsWith('agent:') &&
          rawWriter.slice('agent:'.length).trim() !== ''
        ? (rawWriter as `agent:${string}`)
        : null
  if (
    id === null ||
    itemText === null ||
    status === undefined ||
    position === null ||
    updatedAt === null ||
    updatedBy === null
  ) {
    return null
  }

  return { id, text: itemText, status, position, updatedBy, updatedAt }
}

/** The five statuses, as a set for the parser - the wire may claim any string. */
export const PLAN_STATUS: ReadonlyMap<unknown, ArtifactStatus> = new Map([
  ['pending', 'pending'],
  ['running', 'running'],
  ['done', 'done'],
  ['failed', 'failed'],
  ['cancelled', 'cancelled'],
])
