import { motion } from 'framer-motion'
import { SPRING_SNAPPY } from '@/design/tokens'

/**
 * The chip behind the selected row of a list, shared across the list.
 *
 * Rendered by the row that is selected and nowhere else, with one
 * `layoutId` per list: Framer then moves the chip from the old row to the
 * new one instead of fading one out and another in, so a selection reads as
 * travel rather than as a swap. The row must be `relative` and its own
 * content `relative` too, or the chip paints over the label.
 *
 * `bg-selected` is translucent, which is why a selected row takes no hover
 * tint of its own -- a tint beneath the chip would deepen the selection
 * under the pointer, two channels for one state.
 */
export function SelectionChip({ list }: { list: string }) {
  return (
    <motion.span
      layoutId={`${list}-selection`}
      transition={SPRING_SNAPPY}
      aria-hidden
      className="absolute inset-0 rounded-md bg-selected"
    />
  )
}
