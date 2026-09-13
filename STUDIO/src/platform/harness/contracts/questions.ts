/**
 * A question a run asks a person, with its options and the payload behind
 * them.
 */

import { isRecord } from '@/lib/guards'
import { finiteNumber, listOf, text } from './guards'

/*
 * Mirrored from `GET /api/questions/pending`: one element of what
 * `QuestionBroker.list()` answers, a row of the durable `pending_question`
 * table (`STUDIO HARNESS/src/questions/pending-questions.ts`). These are the
 * questions a run asks to get a DECISION, not consent for an action - which
 * is why this is a separate record from `PendingApprovalRecord` and never
 * becomes one: a permission question has no deadline and no default, a
 * product question has both, and the two vocabularies do not meet.
 *
 * The payload is what the card renders: a sentence, a short header, options
 * with the consequence of choosing each, and which option - if any - a
 * timeout may take. It carries no credential and describes no capability.
 */

/** One choice on a question, as the ask card renders it. */
export interface PendingQuestionOption {
  readonly id: string
  readonly label: string
  /** What happens if this option is chosen, said before the choice. */
  readonly description: string
}

export interface PendingQuestionPayload {
  readonly question: string
  /** A short label, at most twelve characters, for the compact display. */
  readonly header: string
  readonly options: readonly PendingQuestionOption[]
  /** Whether several options may be chosen at once. */
  readonly multiSelect: boolean
  /**
   * The option a timeout may take, and the only thing it may take. Null means
   * the question parks forever instead of timing out - and the card renders
   * no countdown, because a timer on a question that will wait forever is a
   * lie.
   */
  readonly recommendedOptionId: string | null
}

export interface PendingQuestionRecord {
  readonly id: string
  /** The conversation whose run asked, bare: `cnv_x`, not `conversation:cnv_x`. */
  readonly conversationId: string
  /** When the harness raised it. The queue is answered oldest first. */
  readonly createdAt: number
  /** The stored deadline, or null when this question waits indefinitely. */
  readonly expiresAt: number | null
  readonly payload: PendingQuestionPayload
}

export function parsePendingQuestion(value: unknown): PendingQuestionRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const conversationId = text(value['conversationId'])
  const createdAt = finiteNumber(value['createdAt'])
  if (id === null || conversationId === null || createdAt === null) return null

  const payload = parseQuestionPayload(value['payload'])
  if (payload === null) return null

  // Null is a stored fact here - the question parks indefinitely - so null is
  // accepted and anything that is neither null nor a number refuses the row.
  const rawExpiresAt = value['expiresAt']
  let expiresAt: number | null = null
  if (rawExpiresAt !== null) {
    const parsed = finiteNumber(rawExpiresAt)
    if (parsed === null) return null
    expiresAt = parsed
  }

  return { id, conversationId, createdAt, expiresAt, payload }
}

export function parseQuestionPayload(value: unknown): PendingQuestionPayload | null {
  if (!isRecord(value)) return null

  const question = text(value['question'])
  const header = text(value['header'])
  const multiSelect = value['multiSelect']
  if (question === null || header === null || typeof multiSelect !== 'boolean') return null

  const options = listOf(
    (option: unknown) => {
      if (!isRecord(option)) return null
      const id = text(option['id'])
      const label = text(option['label'])
      const description = text(option['description'])
      if (id === null || label === null || description === null) return null
      return { id, label, description }
    },
    value['options'],
  )
  if (options === null) return null

  const recommendedOptionId = text(value['recommendedOptionId'])
  return {
    question,
    header,
    options,
    multiSelect,
    ...(recommendedOptionId === null ? { recommendedOptionId: null } : { recommendedOptionId }),
  }
}

export function parsePendingQuestions(value: unknown): readonly PendingQuestionRecord[] | null {
  return listOf(parsePendingQuestion, value)
}
