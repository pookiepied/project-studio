/**
 * A point the project can be returned to, and what a restore leaves behind.
 */

import { isRecord } from '@/lib/guards'
import { finiteNumber, listOf, text } from './guards'

/*
 * Mirrored from `GET /api/conversations/:id/snapshots`: one element of what
 * `SnapshotStore.list()` answers
 * (`STUDIO HARNESS/src/snapshots/store.ts`). A snapshot is a commit in the
 * shadow repository that watches the project from outside it - the undo
 * history every write-bearing turn records, and the thing the restore route
 * returns the project to.
 */
export interface SnapshotRecord {
  /** The commit id in the shadow repository. */
  readonly id: string
  /** The label the point was taken under, e.g. `turn 3`. */
  readonly label: string
  readonly takenAt: number
}

/** What a restore answers: the point that holds the state just left behind. */
export interface SnapshotRestore {
  readonly undo: SnapshotRecord
}

export function parseSnapshotRecord(value: unknown): SnapshotRecord | null {
  if (!isRecord(value)) return null

  const id = text(value['id'])
  const label = text(value['label'])
  const takenAt = finiteNumber(value['takenAt'])
  if (id === null || label === null || takenAt === null) return null

  return { id, label, takenAt }
}

export function parseSnapshots(value: unknown): readonly SnapshotRecord[] | null {
  return listOf(parseSnapshotRecord, value)
}

export function parseSnapshotRestore(value: unknown): SnapshotRestore | null {
  if (!isRecord(value)) return null
  const undo = parseSnapshotRecord(value['undo'])
  return undo === null ? null : { undo }
}
