import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { AppearanceProvider } from '@/design/theme'
import { EASE_OUT, SPLASH } from '@/design/tokens'
import { signalAppReady, suppressWebviewChrome } from '@/platform/tauri'
import { AppShell } from '@/shell/AppShell'
import { SplashScreen } from '@/shell/SplashScreen'
import { NavigationProvider } from '@/stores/navigation'
import { WorkspaceProvider } from '@/stores/workspace'

export default function App() {
  // Clock started at first render, not inside the effect: StrictMode remounts
  // effects in development, and a clock that restarts with them would stretch
  // the splash by the remount gap.
  const startedAt = useRef(performance.now())
  const [showSplash, setShowSplash] = useState(true)

  useEffect(() => {
    // The splash stays for its full entrance even on an instant boot -- the
    // mark is interrupted mid-arrival otherwise. Elapsed time is subtracted so
    // a slow mount shortens the wait rather than stacking on top of it.
    const elapsed = performance.now() - startedAt.current
    const remaining = Math.max(0, SPLASH.minDurationMs - elapsed)
    const timer = window.setTimeout(() => setShowSplash(false), remaining)
    return () => window.clearTimeout(timer)
  }, [])

  useEffect(() => {
    // Startup contract: the native window stays hidden until the first paint,
    // so nobody sees a blank frame. See `visible: false` in tauri.conf.json.
    // The first paint is the splash, so the window appears on it.
    void signalAppReady()
    return suppressWebviewChrome()
  }, [])

  return (
    /*
      `reducedMotion="user"` is the whole reduced-motion story for Framer: it
      strips transforms and layout animations app-wide while keeping opacity,
      which is the correct fallback for every animation in `design/tokens`. CSS
      transitions are covered by the matching media query in `index.css`. Never
      branch on the preference inside a component -- one switch, here.
    */
    <MotionConfig reducedMotion="user">
      <AppearanceProvider>
        <WorkspaceProvider>
          <NavigationProvider>
            <motion.div
              className="h-full"
              initial={{ opacity: 0, scale: 0.99 }}
              animate={{ opacity: showSplash ? 0 : 1, scale: showSplash ? 0.99 : 1 }}
              transition={{ duration: SPLASH.revealDuration, ease: EASE_OUT }}
            >
              <AppShell />
            </motion.div>
            <AnimatePresence>{showSplash ? <SplashScreen /> : null}</AnimatePresence>
          </NavigationProvider>
        </WorkspaceProvider>
      </AppearanceProvider>
    </MotionConfig>
  )
}
