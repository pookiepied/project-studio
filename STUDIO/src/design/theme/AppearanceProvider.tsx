import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  applyAppearance,
  forgetAppearance,
  isDefaultAppearance,
  resolveTheme,
  saveAppearance,
  watchAppearance,
  DEFAULT_APPEARANCE,
  type Appearance,
  type ResolvedTheme,
} from '@/design/theme/appearance'

interface AppearanceContextValue {
  readonly appearance: Appearance
  readonly resolvedTheme: ResolvedTheme
  /** True when nothing here differs from what the app ships with. */
  readonly isDefault: boolean
  update: (change: Partial<Appearance>) => void
  /** Forget every stored preference and return to the shipped defaults. */
  reset: () => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

/**
 * Owns every appearance decision: theme, text sizes, cursor, persistence, and
 * the class and variables on <html> that the whole token system reads.
 */
export function AppearanceProvider({
  initial,
  children,
}: {
  /**
   * Read from the store before React mounts — see `main.tsx`.
   *
   * Passed in rather than loaded here because the store is a file and reading
   * it is asynchronous, and a provider that starts at the defaults and
   * corrects itself an effect later would paint one frame at the wrong size
   * and theme. The window is hidden until `app_ready`, so the read costs
   * nothing visible; a flash would have cost the whole startup.
   */
  initial: Appearance
  children: ReactNode
}) {
  const [appearance, setAppearance] = useState<Appearance>(initial)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(appearance.theme),
  )
  // Receiving another window's preference must never echo a write back.
  const locallyChanged = useRef(false)

  useEffect(() => {
    let disposed = false
    let off: (() => void) | undefined
    void watchAppearance((next) => {
      if (disposed || locallyChanged.current) return
      setAppearance((current) => current.theme === next.theme && current.uiSize === next.uiSize
        && current.codeOffset === next.codeOffset && current.pointerCursor === next.pointerCursor ? current : next)
    }).then((unsubscribe) => { if (disposed) unsubscribe(); else off = unsubscribe }).catch(() => undefined)
    return () => { disposed = true; off?.() }
  }, [])

  useEffect(() => {
    setResolvedTheme(applyAppearance(appearance))
    if (locallyChanged.current) {
      locallyChanged.current = false
      // Only a *deviation* is stored. Matching the defaults deletes the entry
      // rather than writing the defaults into it, and the difference is the
      // whole point: an absent value means "no opinion", so a future change to
      // what Studio ships with reaches everyone who never expressed one.
      // Writing the defaults in would freeze today's numbers into every
      // install that ever opened this pane.
      //
      // This is also what makes Reset actually reset. It used to delete the
      // stored value and then this effect immediately wrote it straight back
      // — the live state returned to the defaults, the file did not, and the
      // reset was undone one tick after it ran.
      void (isDefaultAppearance(appearance) ? forgetAppearance() : saveAppearance(appearance))
    }

    if (appearance.theme !== 'system') return
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setResolvedTheme(applyAppearance(appearance))
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [appearance])

  const value = useMemo<AppearanceContextValue>(
    () => ({
      appearance,
      resolvedTheme,
      isDefault: isDefaultAppearance(appearance),
      update: (change) => { locallyChanged.current = true; setAppearance((current) => ({ ...current, ...change })) },
      // Returning the live state to the defaults is enough: the effect above
      // sees an appearance that matches them and clears the stored entry.
      reset: () => { locallyChanged.current = true; setAppearance({ ...DEFAULT_APPEARANCE }) },
    }),
    [appearance, resolvedTheme],
  )

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>
}

export function useAppearance(): AppearanceContextValue {
  const context = useContext(AppearanceContext)
  if (!context) throw new Error('useAppearance must be used within AppearanceProvider')
  return context
}
