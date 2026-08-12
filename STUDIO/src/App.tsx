import { useEffect } from 'react'
import { MotionConfig } from 'framer-motion'
import { invoke } from '@tauri-apps/api/core'
import { AppShell } from '@/app/shell/AppShell'
import { ChromeProvider } from '@/app/shell/ChromeProvider'
import { ThemeProvider } from '@/app/theme/ThemeProvider'
import { NavigationProvider } from '@/app/navigation/NavigationProvider'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ProjectsProvider } from '@/features/projects/ProjectsProvider'
import { signalAppReady } from '@/platform/tauri/window'

export default function App() {
  useEffect(() => {
    // Startup contract: the window stays hidden until the first paint.
    void signalAppReady(invoke)
  }, [])

  return (
    /*
      `reducedMotion="user"` is the whole reduced-motion story for Framer: it
      strips transforms and layout animations app-wide while keeping opacity,
      which is the correct fallback for every animation in `app/motion.ts`.
      CSS transitions are covered by the matching media query in `index.css`.
      Do not branch on the preference inside components — one switch, here.
    */
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <NavigationProvider>
          <ProjectsProvider>
            <ChromeProvider>
              <TooltipProvider delay={400}>
                <AppShell />
              </TooltipProvider>
            </ChromeProvider>
          </ProjectsProvider>
        </NavigationProvider>
      </ThemeProvider>
    </MotionConfig>
  )
}
