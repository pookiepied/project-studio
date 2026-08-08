import { useEffect } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AppShell } from '@/app/shell/AppShell'
import { ThemeProvider } from '@/app/theme/ThemeProvider'
import { NavigationProvider } from '@/app/navigation/NavigationProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { signalAppReady } from '@/platform/tauri/window'

export default function App() {
  useEffect(() => {
    // Startup contract: the window stays hidden until the first paint.
    void signalAppReady(invoke)
  }, [])

  return (
    <ThemeProvider>
      <NavigationProvider>
        <TooltipProvider delay={300}>
          <AppShell />
        </TooltipProvider>
      </NavigationProvider>
    </ThemeProvider>
  )
}
