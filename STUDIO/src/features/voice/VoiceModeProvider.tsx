import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { VoiceModeOverlay } from '@/features/voice/VoiceModeOverlay'

/**
 * Who may open the voice stage, and where it renders.
 *
 * The composer starts voice mode; the stage itself is not part of the page
 * the composer sits in — it takes the whole window, sidebar and all, so it
 * is mounted as a sibling of the shell's contents rather than inside any
 * page. A context is the seam between those two positions: the composer does
 * not know where the stage lives, and the stage does not know what opened it.
 *
 * Both shells mount one — the studio and a detached conversation window each
 * get their own stage over their own contents, because a voice mode that
 * worked in one window and not the other is exactly the drift `DetachedShell`
 * exists to prevent.
 */

interface VoiceModeValue {
  readonly active: boolean
  readonly enter: () => void
  readonly leave: () => void
}

const VoiceModeContext = createContext<VoiceModeValue | null>(null)

export function VoiceModeProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false)
  const enter = useCallback(() => setActive(true), [])
  const leave = useCallback(() => setActive(false), [])
  const value = useMemo(() => ({ active, enter, leave }), [active, enter, leave])

  return (
    <VoiceModeContext.Provider value={value}>
      {children}
      <VoiceModeOverlay open={active} onClose={leave} />
    </VoiceModeContext.Provider>
  )
}

export function useVoiceModeContext(): VoiceModeValue {
  const context = useContext(VoiceModeContext)
  if (!context) throw new Error('useVoiceModeContext must be used within VoiceModeProvider')
  return context
}
