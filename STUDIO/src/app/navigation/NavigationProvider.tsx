import { createContext, useContext, useState, type ReactNode } from 'react'
import type { View } from '@/app/navigation/views'

interface NavigationContextValue {
  view: View
  setView: (view: View) => void
}

const NavigationContext = createContext<NavigationContextValue | null>(null)

/** Owns which surface the shell is showing. Nothing else holds this state. */
export function NavigationProvider({ children }: { children: ReactNode }) {
  const [view, setView] = useState<View>('chat')

  return (
    <NavigationContext.Provider value={{ view, setView }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext)
  if (!context) throw new Error('useNavigation must be used within NavigationProvider')
  return context
}
