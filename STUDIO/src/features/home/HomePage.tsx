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
 * "What are we making?" was a prompt, and a prompt on an empty screen is the
 * software asking the user to perform. This says what Studio is instead, in the
 * voice the rest of the app is written in: plain, declarative, and about the
 * work rather than about the tool. It is the one display moment in the app, so
 * it carries the serif and the serif goes nowhere else.
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
          <h1 className="studio-display text-foreground">A quieter way to work.</h1>
          <p className="mt-2 text-ui text-muted-foreground">
            Everything it can do, none of it in the way.
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
