import { motion } from 'framer-motion'
import { COLLAPSE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { WorkingDots } from '@/components/state'

/**
 * A compaction of this conversation, in flight.
 *
 * The quiet line that stands at the transcript's tail from the moment a
 * compaction is asked for — "Compact now" in the model menu, `/compact` in
 * the field, one store flag either way — until the harness writes the record.
 * Without it the request is silence: the round trip is seconds on a real
 * conversation, the field has already cleared, and nothing anywhere said the
 * ask had been heard. The row is the same voice the record line speaks in —
 * the mark, a caption, the working dots beside the label — so the handover
 * reads as one line changing state: this row collapses as `CompactionMarker`
 * appears beneath where it stood, the wait becoming the fact it was waiting
 * for.
 *
 * The handover is a swap, not a collapse: the row holds its slot until the
 * record is in the log, then goes in the same render the record appears, at
 * the record's own height - the two lines share their box exactly, so there
 * is no padding here the record does not have (see `useCompactionHandover`).
 * Any other leaving - a refused compaction - folds away with the house
 * collapse, height and all, because the row lives in a `gap-6` column and a
 * fade alone would leave its gap behind.
 */
export function CompactingRow() {
  return (
    <motion.div {...COLLAPSE} className="overflow-hidden">
      <div
        className="studio-message flex items-center gap-1.5 text-caption text-muted-foreground"
        role="status"
      >
        <Icons.compaction size="sm" />
        <span>Compacting conversation</span>
        <WorkingDots size="sm" />
      </div>
    </motion.div>
  )
}
