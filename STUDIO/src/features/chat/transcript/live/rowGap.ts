/**
 * The one gap between two rows of a turn - a thought, a tool row, the
 * person's answers - wherever they stand: inside an opened activity block, or
 * one after another outside it.
 *
 * Rows outside a group used to touch or stand apart depending on which kind
 * came first: a thought carried a bottom margin of its own and a question row
 * carried none, so a thought above a question stood apart while a question
 * above a thought sat tight. Now no row carries an outer margin for a row
 * neighbour; the row below takes this gap, and a run of loose rows reads with
 * the rhythm an opened group has. Words above or below are a different
 * boundary and keep their own, larger margin.
 */
export const ROW_GAP_CLASS = 'gap-2'
export const ROW_GAP_MARGIN = 'mt-2'
