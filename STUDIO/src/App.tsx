import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { AppearanceProvider, type Appearance } from '@/design/theme'
import { EASE_OUT, SPLASH } from '@/design/tokens'
import {
  detachedConversationId,
  browserConversationId,
  diagnosticKind,
  indicatorKind,
  overlayKind,
  signalAppReady,
  suppressWebviewChrome,
} from '@/platform/tauri'
import { AppShell } from '@/shell/AppShell'
import { ComputerIndicatorWindow } from '@/shell/ComputerIndicatorWindow'
import { ScreenOverlayWindow } from '@/features/screen/ScreenOverlayWindow'
import { DiagnosticWindow } from '@/shell/DiagnosticWindow'
import { CaptureMonitor } from '@/shell/CaptureMonitor'
import { DetachedShell } from '@/shell/DetachedShell'
import { BrowserWindow } from '@/features/browser/BrowserWindow'
import { PairingGate } from '@/shell/PairingGate'
import { SplashScreen } from '@/shell/SplashScreen'
import { useFileDropGuard } from '@/shell/useFileDropGuard'
import { NavigationProvider, useNavigation } from '@/stores/navigation'
import { RailProvider } from '@/stores/rail'
import { WorkspaceProvider, useWorkspace } from '@/stores/workspace'

/**
 * The root, and all of the routing there is: a window is either the studio or
 * one conversation opened away from it, and which one it is was decided by its
 * URL before any React ran. `open_conversation_window` opens the same bundle
 * with `?conversation=<id>`; the main window opens it with no query at all.
 *
 * The provider stack is shared rather than given a detached copy, because the
 * detached shell renders the *real* `ChatPage` — and its transcript reaches
 * the rail (artifacts), the turn menu reaches the workspace, the identity line
 * reaches navigation. A slimmer stack would work until the first artifact
 * opened, then throw.
 */
export default function App({ initialAppearance }: { initialAppearance: Appearance }) {
  useFileDropGuard()
  // Read once and never stored: the URL is fixed for the life of a window, so
  // this is a fact about which window this is, not state.
  const detached = detachedConversationId()
  const browserConversation = browserConversationId()
  const diagnostic = diagnosticKind()
  const indicator = indicatorKind()
  const overlay = overlayKind()

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

  // The diagnostic window stops here, above the provider stack, because it
  // needs nothing from it: it asks the supervisor one question over the Tauri
  // seam and renders the answer. Mounting `WorkspaceProvider` around a window
  // whose entire subject is that the harness is down would have it reaching
  // for a store that by definition is not there.
  // The computer indicator stops here for the same reason, and further: it
  // needs no pairing and no harness, only the theme, because its one action
  // is a call to the native side. See `ComputerIndicatorWindow`.
  // The screen overlay stops here for the indicator's reasons: it draws
  // what Rust tells it to and answers through Rust. See `ScreenOverlayWindow`.
  if (overlay === 'screen') {
    return (
      <MotionConfig reducedMotion="user">
        <AppearanceProvider initial={initialAppearance}>
          <ScreenOverlayWindow />
        </AppearanceProvider>
      </MotionConfig>
    )
  }

  if (indicator === 'computer') {
    return (
      <MotionConfig reducedMotion="user">
        <AppearanceProvider initial={initialAppearance}>
          <ComputerIndicatorWindow />
        </AppearanceProvider>
      </MotionConfig>
    )
  }

  if (diagnostic !== null) {
    return (
      <MotionConfig reducedMotion="user">
        <AppearanceProvider initial={initialAppearance}>
          <PairingGate>
            <DiagnosticWindow />
          </PairingGate>
        </AppearanceProvider>
      </MotionConfig>
    )
  }

  return (
    /*
      `reducedMotion="user"` is the whole reduced-motion story for Framer: it
      strips transforms and layout animations app-wide while keeping opacity,
      which is the correct fallback for every animation in `design/tokens`. CSS
      transitions are covered by the matching media query in `styles/base.css`. Never
      branch on the preference inside a component — one switch, here.
    */
    <MotionConfig reducedMotion="user">
      <AppearanceProvider initial={initialAppearance}>
        {/* The pairing gate wraps every window a browser can render, above
            the provider stack: an unpaired device gets the pairing screen and
            none of the stores, and inside Tauri it is a pass-through that
            never asks. See `PairingGate`. */}
        <PairingGate>
          <WorkspaceProvider>
            <NavigationProvider>
              <ConversationWorkspace detached={detached}>
                <CaptureMonitor />
                {browserConversation ? <BrowserWindow conversationId={browserConversation} /> : detached ? <DetachedShell conversationId={detached} /> : <StudioApp />}
              </ConversationWorkspace>
            </NavigationProvider>
          </WorkspaceProvider>
        </PairingGate>
      </AppearanceProvider>
    </MotionConfig>
  )
}

/** The main window: the studio, arriving out of the splash. */
function ConversationWorkspace({ detached, children }: { detached: string | null; children: ReactNode }) {
  const { route } = useNavigation()
  return <RailProvider conversationId={detached ?? (route.kind === 'chat' ? route.conversationId : null)}>{children}</RailProvider>
}

function StudioApp() {
  // Clock started at first render, not inside the effect: StrictMode remounts
  // effects in development, and a clock that restarts with them would stretch
  // the splash by the remount gap.
  const startedAt = useRef(performance.now())
  const [showSplash, setShowSplash] = useState(true)
  const { storePhase } = useWorkspace()

  // The splash holds until the store has an answer, within a cap.
  //
  // The harness is started under it, and on a cold start it is ready a
  // second or two after the window is. Lifting the splash on the clock alone
  // showed "the harness is not running" for that second and then the app -
  // the window arriving twice, the first time wrong. Waiting for the store's
  // first read means the app arrives once, with the harness already behind
  // it; it costs nothing on a warm start, where the read is faster than the
  // splash's own minimum. The cap is for a start that is not going to end:
  // past it the app comes up and says what it knows.
  const settled = storePhase.status !== 'loading'
  useEffect(() => {
    // The splash stays for its full entrance even on an instant boot — the
    // mark is interrupted mid-arrival otherwise. Elapsed time is subtracted so
    // a slow mount shortens the wait rather than stacking on top of it. Once
    // the store has answered, one more beat for the shell to take the answer
    // before the splash lifts off it.
    const elapsed = performance.now() - startedAt.current
    const floor = Math.max(0, SPLASH.minDurationMs - elapsed)
    const ceiling = Math.max(0, SPLASH.minDurationMs + SPLASH.maxHoldMs - elapsed)
    const timer = window.setTimeout(
      () => setShowSplash(false),
      settled ? Math.max(floor, SPLASH.settleMs) : ceiling,
    )
    return () => window.clearTimeout(timer)
  }, [settled])

  return (
    <>
      {/* The app is fully painted the whole time; only the splash moves.

          It used to cross-fade — the shell animating 0 -> 1 while the
          splash animated 1 -> 0 over a similar duration. Two opacities
          passing through each other is what read as a flash: at the
          midpoint both layers are half-transparent, so for a few frames
          the window is a wash of neither, and then the app snaps into
          being. Nothing was too fast; there were simply two things
          dissolving at once and no moment that belonged to either.

          Fading one layer away from a finished one underneath is a
          reveal, and it only has to be paced once — see `SplashScreen`.
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
      <AnimatePresence>{showSplash ? <SplashScreen waiting={!settled} /> : null}</AnimatePresence>
    </>
  )
}
