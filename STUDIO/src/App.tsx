import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { AppearanceProvider } from '@/design/theme'
import { EASE_OUT, SPLASH } from '@/design/tokens'
import { detachedConversationId, signalAppReady, suppressWebviewChrome } from '@/platform/tauri'
import { AppShell } from '@/shell/AppShell'
import { DetachedShell } from '@/shell/DetachedShell'
import { SplashScreen } from '@/shell/SplashScreen'
import { NavigationProvider } from '@/stores/navigation'
import { RailProvider } from '@/stores/rail'
import { WorkspaceProvider } from '@/stores/workspace'

/**
 * The root, and all of the routing there is: a window is either the studio or
 * one conversation opened away from it, and which one it is was decided by its
 * URL before any React ran. `open_conversation_window` opens the same bundle
 * with `?conversation=<id>`; the main window opens it with no query at all.
 *
 * The provider stack is shared rather than given a detached copy, because the
 * detached shell renders the *real* `ChatPage` -- and its transcript reaches
 * the rail (artifacts), the turn menu reaches the workspace, the identity line
 * reaches navigation. A slimmer stack would work until the first artifact
 * opened, then throw.
 */
export default function App() {
  // Read once and never stored: the URL is fixed for the life of a window, so
  // this is a fact about which window this is, not state.
  const detached = detachedConversationId()

  useEffect(() => {
    // Startup contract: the native window stays hidden until the first paint,
    // so nobody sees a blank frame. See `visible: false` in tauri.conf.json,
    // and the same flag on every window `open_conversation_window` builds.
    // `app_ready` shows whichever window called it, so both kinds are covered
    // by the one call. In the main window the first paint is the splash; in a
    // detached one it is the conversation.
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
        <RailProvider>
          <NavigationProvider>
            {detached ? <DetachedShell conversationId={detached} /> : <StudioApp />}
          </NavigationProvider>
        </RailProvider>
      </WorkspaceProvider>
      </AppearanceProvider>
    </MotionConfig>
  )
}

/** The main window: the studio, arriving out of the splash. */
function StudioApp() {
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

  return (
    <>
      {/* The app is fully painted the whole time; only the splash moves.

          It used to cross-fade -- the shell animating 0 -> 1 while the
          splash animated 1 -> 0 over a similar duration. Two opacities
          passing through each other is what read as a flash: at the
          midpoint both layers are half-transparent, so for a few frames
          the window is a wash of neither, and then the app snaps into
          being. Nothing was too fast; there were simply two things
          dissolving at once and no moment that belonged to either.

          Fading one layer away from a finished one underneath is a
          reveal, and it only has to be paced once -- see `SplashScreen`.
          The shell keeps a slight scale so the arrival still has
          movement, but it starts as soon as the splash begins to leave
          rather than waiting for it to finish. */}
      <motion.div
        className="h-full"
        initial={{ scale: 0.985 }}
        animate={{ scale: showSplash ? 0.985 : 1 }}
        transition={{ duration: SPLASH.revealDuration, ease: EASE_OUT }}
      >
        <AppShell />
      </motion.div>
      <AnimatePresence>{showSplash ? <SplashScreen /> : null}</AnimatePresence>
    </>
  )
}
