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
 * A greeting for the time of day, and nothing under it. It has been a prompt
 * ("What are we making?") and a pair of claims ("A quieter way to work. /
 * Everything it can do, none of it in the way."). The prompt asked the
 * person to perform on an empty screen; the claims were the software
 * describing itself to someone who had already opened it, and the second
 * line meant nothing to anyone who had not read the design notes. A
 * greeting is the one line that is about the person rather than the tool,
 * and it is what the calmest screen in a well-made app tends to say. The
 * field's placeholder does the inviting. This is the one display moment in
 * the app, so it carries the serif and the serif goes nowhere else.
 *
 * ---- Where the first message goes ------------------------------------------
 *
 * To the harness, like every message after it, through `StartConversation` —
 * which owns what starting one means and is shared with the project page. All
 * this surface decides is that a conversation started here belongs to no
 * project.
 */
/** Morning until noon, afternoon until six, evening after. */
export function greetingFor(hour: number): string {
  if (hour < 12) return 'Good morning.'
  if (hour < 18) return 'Good afternoon.'
  return 'Good evening.'
}

export function HomePage() {
  const greeting = greetingFor(new Date().getHours())
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
          <h1 className="studio-display text-foreground">{greeting}</h1>
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
