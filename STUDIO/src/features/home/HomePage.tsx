import { motion, useIsPresent, useReducedMotion } from 'framer-motion'
import { StudioMark } from '@/components/brand'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { StartConversation } from '@/features/chat/composer'
import './home.css'

export function HomePage() {
  const present = useIsPresent()
  const reducedMotion = useReducedMotion()

  return (
    <div
      data-attachment-drop-zone
      className="flex h-full flex-col items-center justify-center"
      style={{ paddingBottom: SHELL.topStrip.height }}
    >
      <div className="studio-content-column">
        <div className="studio-home-intro mb-7 text-center" data-leaving={!present || undefined}>
          <div className="studio-home-clover-hitbox mx-auto w-fit">
            <StudioMark entrance size={72} className="studio-home-clover text-[color:var(--brand-ink)]" />
          </div>
          <p className="mt-2 truncate font-display text-lg leading-tight text-muted-foreground">
            <q cite="https://www.gutenberg.org/files/1497/1497-h/1497-h.htm" title="Plato, The Republic (translated by Benjamin Jowett)">
              The beginning is the most important part of any work.
            </q>
          </p>
        </div>

        <motion.div
          initial={reducedMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT, delay: 0.05 }}
        >
          <StartConversation projectId={null} placeholder="Ask anything" />
        </motion.div>
      </div>
    </div>
  )
}
