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
 * The height is part of every pose (the house collapse) rather than only the
 * opacity, because the row lives at the end of a `gap-6` column: a row that
 * only faded would leave its slot and its gap behind while the record took
 * its place, and the list would jump twice for one event.
 */
export function CompactingRow() {
  return (
    <motion.div {...COLLAPSE} className="overflow-hidden">
      <div
        className="studio-message flex items-center gap-1.5 py-0.5 text-caption text-muted-foreground"
        role="status"
      >
        <Icons.compaction size="sm" />
        <span>Compacting conversation</span>
        <WorkingDots size="sm" />
      </div>
    </motion.div>
  )
}
