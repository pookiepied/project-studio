import { useEffect, useState } from 'react'

/**
 * How long the wait line outlives the compacting flag when no record follows.
 * The record normally lands well inside this - the page reattaches the moment
 * the flag clears - and a refusal lands no record at all, so this is only how
 * long a refused compaction's line lingers before it folds away.
 */
export const HANDOVER_GRACE_MS = 2_500

/**
 * The compaction wait line and the record that replaces it, as one line.
 *
 * ---- The jump this exists to end ------------------------------------------
 *
 * The compacting flag clears when the harness answers, and the record line
 * arrives only after the page has reattached and re-read the log - a beat
 * later. So the wait line collapsed (the list moved up by a line and a gap)
 * and then the record appeared (the list moved down again): two jumps for one
 * event, and the second one landed under the reader's eye.
 *
 * Now the wait line holds its slot from the moment the flag is set until the
 * log holds one more compaction record than it did then. In the render where
 * that record arrives (`handedOver`) the wait line is unmounted outright - no
 * exit, so there is no frame holding both lines - and the record takes the
 * same slot at the same height, so nothing below it moves. If no record
 * comes - the harness refused - the line folds away as it always did, after
 * a short grace.
 */
export function useCompactionHandover(
  compacting: boolean,
  records: number,
): { readonly waiting: boolean; readonly handedOver: boolean } {
  // How many records the log held when this compaction began.
  const [baseline, setBaseline] = useState<number | null>(null)

  const from = baseline ?? (compacting ? records : null)
  const arrived = from !== null && records > from
  const waiting = from !== null && !arrived

  useEffect(() => {
    if (compacting && baseline === null) {
      setBaseline(records)
      return
    }
    if (baseline === null) return
    if (records > baseline) {
      if (!compacting) setBaseline(null)
      return
    }
    if (compacting) return
    const timer = setTimeout(() => setBaseline(null), HANDOVER_GRACE_MS)
    return () => clearTimeout(timer)
  }, [compacting, records, baseline])

  return { waiting, handedOver: arrived }
}
