import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

export type Section = 'overview' | 'requests' | 'models' | 'providers' | 'tokens' | 'routing' | 'health' | 'settings'

interface GatewayNavigationValue {
  section: Section
  setSection: (section: Section) => void
}

const GatewayNavigationContext = createContext<GatewayNavigationValue | null>(null)

export function GatewayNavigationProvider({ children }: { children: ReactNode }) {
  const [section, setSection] = useState<Section>('overview')
  const set = useCallback((next: Section) => setSection(next), [])
  return (
    <GatewayNavigationContext.Provider value={{ section, setSection: set }}>
      {children}
    </GatewayNavigationContext.Provider>
  )
}

export function useGatewayNavigation(): GatewayNavigationValue {
  const ctx = useContext(GatewayNavigationContext)
  if (!ctx) throw new Error('useGatewayNavigation must be used within GatewayNavigationProvider')
  return ctx
}
