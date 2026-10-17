import { motion } from 'framer-motion'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { StartConversation } from '@/features/chat/composer'

/**
 * The home surface.
 *
 * A line and a field. Nothing else — no recents, no project grid, no cards.
 * Recents used to sit under the composer and they are gone on purpose: the
 * sidebar is where conversations live, and listing them here too meant the
 * first thing on the calmest screen in the app was a duplicate of the column
 * beside it.
 *
 * ---- The line -------------------------------------------------------------
 *
 * Two lines: a statement in the serif and a plainer line under it, the
 * shape the page has always had. What they say has changed three times. A
 * prompt ("What are we making?") asked the person to perform on an empty
 * screen. A pair of claims ("A quieter way to work. / Everything it can
 * do, none of it in the way.") was the software describing itself, and the
 * second line meant nothing to anyone who had not read the design notes. A
 * greeting alone, tried next, left the page feeling unfurnished - one short
 * line over a field reads as a form.
 *
 * So: two lines, the same lengths as before, and both about what the
 * person can do here rather than what the tool is. The first is an
 * invitation with no demand in it; the second names the three shapes a
 * first message takes, so the empty field is not a blank. This is the one
 * display moment in the app, so it carries the serif and the serif goes
 * nowhere else.
 *
 * ---- Where the first message goes ------------------------------------------
 *
 * To the harness, like every message after it, through `StartConversation` —
 * which owns what starting one means and is shared with the project page. All
 * this surface decides is that a conversation started here belongs to no
 * project.
 */
export function HomePage() {
  return (
    <div
      data-attachment-drop-zone
      className="flex h-full flex-col items-center justify-center"
      style={{ paddingInline: SHELL.gutter, paddingBottom: SHELL.topStrip.height }}
    >
      <div className="w-full" style={{ maxWidth: SHELL.measure }}>
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
          className="mb-7 text-center"
        >
          <h1 className="studio-display text-foreground">Start with anything.</h1>
          <p className="mt-2 text-ui text-muted-foreground">
            A question, a task, or a thought to think through.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.05 }}
        >
          <StartConversation projectId={null} placeholder="Ask anything" />
        </motion.div>
      </div>
    </div>
  )
}
