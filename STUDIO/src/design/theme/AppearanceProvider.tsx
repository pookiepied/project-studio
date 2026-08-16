import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import {
  applyAppearance,
  readAppearance,
  resolveTheme,
  writeAppearance,
  type Appearance,
  type ResolvedTheme,
} from '@/design/theme/appearance'

interface AppearanceContextValue {
  readonly appearance: Appearance
  readonly resolvedTheme: ResolvedTheme
  update: (change: Partial<Appearance>) => void
}

const AppearanceContext = createContext<AppearanceContextValue | null>(null)

/**
 * Owns every appearance decision: theme, text sizes, cursor, persistence, and
 * the class and variables on <html> that the whole token system reads.
 */
export function AppearanceProvider({ children }: { children: ReactNode }) {
  const [appearance, setAppearance] = useState<Appearance>(readAppearance)
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(appearance.theme),
  )

  useEffect(() => {
    setResolvedTheme(applyAppearance(appearance))
    writeAppearance(appearance)

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
      update: (change) => setAppearance((current) => ({ ...current, ...change })),
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
