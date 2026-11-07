import { useEffect, useState } from 'react'
import { RADIUS } from '@/design/tokens'
import { PageTransition } from '@/components/primitives'
import { windowFrame } from '@/shell/chrome/windowFrame'
import { ChatPage } from '@/features/chat'
import { HomePage } from '@/features/home'
import { CommandPalette } from '@/features/palette'
import { NewProjectDialog, ProjectPage } from '@/features/projects'
import { SettingsPage } from '@/features/settings'
import { VoiceModeProvider } from '@/features/voice'
import { ActionsMenu } from '@/shell/menus/ActionsMenu'
import { SelectionMenu } from '@/shell/menus/SelectionMenu'
import { HarnessDownPage } from '@/shell/HarnessDownPage'
import { TopStrip } from '@/shell/chrome/TopStrip'
import { SideRail } from '@/features/rail'
import { Sidebar } from '@/shell/sidebar/Sidebar'
import { usePanelHandover } from '@/shell/panelHandover'
import { useCompactLayout } from '@/shell/useCompactLayout'
import { useNavigation } from '@/stores/navigation'
import { useRail } from '@/stores/rail'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'
import { isTauri } from '@/platform/tauri'

/**
 * The window.
 *
 * One rounded panel filling the transparent OS window. There is no tray and no
 * inset, so there is exactly one radius in the shell — this one, matched by
 * the DWM corner preference in `src-tauri/src/window.rs`. Two radii is how a
 * frameless window ends up with arcs that cross.
 *
 * `overflow-hidden` is what makes the corner real: without it a scrolling
 * transcript paints square right through the rounded edge.
 */
export function AppShell() {
  const { route, move, sidebarOpen, paletteOpen, setPaletteOpen, toggleSidebar, openSettings, goHome } =
    useNavigation()
  /**
   * True while the sidebar's width spring is moving. The page re-lays-out on
   * every frame of that spring, and the transcript is the heaviest thing in
   * it -- mid-flight, at the spring's peak velocity, the whole document
   * rewrapped per frame and the move stuttered exactly in its middle. While
   * this is true the transcript's off-screen rows step out of layout (see
   * `studio-reflow-light` in styles/components.css), and step back in when it lands.
   */
  const [reflowLight, setReflowLight] = useState(false)
  const { conversations, projects, storePhase } = useWorkspace()
  const {
    open: railOpen,
    collapsed: railCollapsed,
    width: railWidth,
    collapse: collapseRail,
    expand: expandRail,
  } = useRail()
  const [newProjectOpen, setNewProjectOpen] = useState(false)

  /**
   * The two columns are mutually exclusive, and the one asked for last wins:
   * the other leaves first, and the arriving one waits for it. The rule and
   * the reasons are with `usePanelHandover`; what the shell draws from is
   * the pair of `shown` flags, never the stores' own `open` directly. The
   * rail is folded rather than closed, so its contents survive. The header's
   * Workspace button restores it through this same handover.
   */
  const { sidebarShown, railShown, sidebarSettled, railSettled } = usePanelHandover({
    sidebarOpen,
    railOpen: route.kind === 'chat' && railOpen,
    closeSidebar: toggleSidebar,
    collapseRail,
  })
  const compact = useCompactLayout(railShown ? railWidth : 0)
  const { setCompactLayout } = useNavigation()
  useEffect(() => {
    if (route.kind !== 'chat') railSettled()
  }, [route.kind, railSettled])

  // The store's leave-Settings rule is a layout answer (a drawer is dismissed
  // where a resident column would be restored), so the shell - the one place
  // the breakpoint is computed - publishes the fact there.
  useEffect(() => {
    setCompactLayout(compact)
  }, [compact, setCompactLayout])

  /** The page only rounds when there is a sidebar beside it to rest on. */
  const rounded = sidebarShown && !compact

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const accel = event.metaKey || event.ctrlKey
      if (!accel) return

      switch (event.key.toLowerCase()) {
        case 'k':
          event.preventDefault()
          // Toggle rather than open: the shortcut that summoned it is the one
          // the hand is already on, so it should dismiss it too.
          setPaletteOpen(!paletteOpen)
          break
        case 'b':
          event.preventDefault()
          toggleSidebar()
          break
        case 'n':
          event.preventDefault()
          goHome()
          break
        case ',':
          event.preventDefault()
          openSettings()
          break
        default:
          break
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [paletteOpen, setPaletteOpen, toggleSidebar, openSettings, goHome])

  // ---- When the whole shell is replaced ------------------------------------
  //
  // One rule: Studio and the harness cannot talk to each other at all. Not
  // "a read failed" -- that is a different situation with a different answer.
  //
  //   no-harness                    the supervisor has no running endpoint.
  //                                 There is no address to send to.
  //   failed + `not-reachable`      an endpoint exists and nothing answers on
  //                                 it. A dead port, a harness that hung.
  //   failed + `unauthorized`       something answers and rejects our
  //                                 credential. The two cannot establish a
  //                                 session.
  //
  // Everything else stays in the shell, and the distinction is whether the
  // harness spoke. `harness-error` and `malformed-response` both mean it
  // answered -- it is alive, reachable, and authenticated, and it either
  // refused one request or sent a body this build could not parse. Replacing
  // the entire window over one bad read would throw away a working app and a
  // sidebar full of real conversations, so those surface where they happened
  // and the shell stays up.
  //
  // Deliberately after every hook in this component: an early return above
  // the two effects would drop them from this render, and a render that calls
  // fewer hooks than the one before it is the blank-window crash this page
  // was written to prevent, not cause.
  const cannotReachHarness =
    storePhase.status === 'no-harness' ||
    (storePhase.status === 'failed' &&
      storePhase.error !== null &&
      (storePhase.error.kind === 'not-reachable' || storePhase.error.kind === 'unauthorized'))

  if (cannotReachHarness) {
    return <HarnessDownPage />
  }

  const frame = windowFrame()

  return (
    <div
      // Sunken, not `surface`. The page's rounded corner cuts away to whatever
      // is behind it, and behind it was the same white the page is painted in
      // — so the radius existed and was invisible. The window's own ground is
      // the sunken tone the sidebar uses, which is what makes the corner read
      // as the page lifting off it. With the sidebar closed the page covers
      // this completely, so nothing shows through.
      className={cn('relative flex h-full w-full overflow-hidden bg-surface-sunken', frame.className)}
      style={frame.style}
    >
      {/* Voice mode mounts inside the rounded root, not at the app root, so
          the stage is clipped by the same window corner everything else is
          and cannot paint outside it. It is the last child for the same
          reason: the stage covers the sidebar and the page on purpose. */}
      <VoiceModeProvider insetRight={railShown ? railWidth : 0}>
        <Sidebar
          open={sidebarShown}
          compact={compact}
          onNewProject={() => setNewProjectOpen(true)}
          onReflow={(moving) => {
            setReflowLight(moving)
            // The spring landing is also the column having settled, which is
            // what a rail waiting on the sidebar's exit is waiting for.
            if (!moving) sidebarSettled()
          }}
        />

      {/* The page is a panel resting on the sidebar, and only while the sidebar
          is there to rest on.

          The radius belongs to the centre, not to the column beside it. Rounding
          the sidebar's edge made it a floating object with the page poured
          around it, which reads as two panels arguing about which one is the
          background. Rounding the page instead states the hierarchy: the
          sidebar is the ground — flush to the window on all four sides — and
          the conversation is the thing sitting on it. It is also what makes the
          sunken surface behind visible as a seam rather than as a border.

          Only the left corners, because only the left edge has anything to sit
          against; the other three meet the window's own corners, and a second
          arc a pixel inside the first is the thing that looks unfinished.

          And it goes away when the sidebar does. With no column beside it the
          page is not resting on anything — a rounded corner against the bare
          window edge would be a panel floating over nothing, which is exactly
          the "why is this cut off" look. Closed, the page is simply the window
          again. */}
      <div
        className={`relative min-w-0 flex-1 overflow-hidden bg-surface transition-[border-radius] duration-base ease-out ${reflowLight ? 'studio-reflow-light' : ''}`}
        // Inline rather than `rounded-l-xl`, so the radius comes from the same
        // token the window's own corner does and the two cannot drift apart.
        // A utility would work equally well; this just keeps one source.
        style={{
          borderTopLeftRadius: rounded ? RADIUS.xl : 0,
          borderBottomLeftRadius: rounded ? RADIUS.xl : 0,
          // The same rule, mirrored: the page's right edge rests on the rail
          // whenever the rail is open, so it rounds against it — and squares
          // off against the window when the rail is gone, exactly as the left
          // edge does when the sidebar is gone. One rule for both edges: round
          // where something is being rested on, square where the window is.
          borderTopRightRadius: railShown ? RADIUS.xl : 0,
          borderBottomRightRadius: railShown ? RADIUS.xl : 0,
        }}
      >
        {/* The strip is page furniture, so it reads the page's own layout
            facts from the shell: whether the sidebar is the floating drawer
            (narrow window) and whether that drawer is on screen decide both
            the toggle's place and the centred title's. */}
        <TopStrip compact={compact} sidebarShown={sidebarShown} onOpenWorkspace={route.kind === 'chat' && railCollapsed ? expandRail : undefined} />

        <PageTransition view={routeKey(route)} move={move} main>
          {Surface({ route, conversations, projects })}
        </PageTransition>
      </div>

      {/* Outside the page's rounded container, so the rail is a sibling of the
          conversation rather than something floating over it. The page keeps
          its own corners; the rail brings its own. */}
      {route.kind === 'chat' ? <SideRail key={route.conversationId} open={railShown} onClosed={railSettled} /> : null}

      <CommandPalette onNewProject={() => setNewProjectOpen(true)} />
      <NewProjectDialog open={newProjectOpen} onClose={() => setNewProjectOpen(false)} />
      {isTauri() ? <ActionsMenu /> : null}
      <SelectionMenu />
      </VoiceModeProvider>
    </div>
  )

}

/**
 * Which page the route points at.
 *
 * ---- Why this is a plain function at module scope --------------------------
 *
 * It used to be `function Surface()` declared *inside* `AppShell` and rendered
 * as `<Surface />`. That one line was the cause of the flicker that survived
 * five separate attempts to fix it somewhere else.
 *
 * A component declared inside another component's body is a brand new function
 * object on every render, and React identifies component types by reference.
 * So on each render of `AppShell` the element type changed, React concluded the
 * old subtree was a different component entirely, and it unmounted the whole
 * page and mounted a fresh one — the transcript, every message, the composer,
 * all of it.
 *
 * That is exactly the reported symptom, including the part that made no sense
 * under any local explanation: *unchanged* bubbles glitching too. They were not
 * glitching. They were being destroyed and rebuilt, which replays every
 * Framer entry animation in the list at once.
 *
 * And it happened precisely while a reply streamed, because that is when
 * `AppShell` re-renders — `useWorkspace()` publishes a new conversation object
 * on every chunk, roughly every 28ms. Some thirty-five remounts of the entire
 * page per second, which no amount of tuning masks, fades or measurement
 * timing could ever have fixed.
 *
 * Calling it (`{Surface({...})}`) inlines the elements it returns into the
 * parent's tree, so there is no component boundary to re-identify and the
 * children keep their identity across renders. Hoisting it out and rendering it
 * as `<Surface {...} />` would work equally well; this way keeps the call site
 * reading as the branch that it is.
 */
function Surface({
  route,
  conversations,
  projects,
}: {
  route: ReturnType<typeof useNavigation>['route']
  conversations: ReturnType<typeof useWorkspace>['conversations']
  projects: ReturnType<typeof useWorkspace>['projects']
}) {
  if (route.kind === 'settings') return <SettingsPage sectionId={route.sectionId} />

  if (route.kind === 'project') {
    const project = projects.find((item) => item.id === route.projectId)
    return project ? <ProjectPage project={project} /> : <HomePage />
  }

  if (route.kind === 'chat') {
    const conversation = conversations.find((item) => item.id === route.conversationId)
    return conversation ? <ChatPage conversation={conversation} /> : <HomePage />
  }

  return <HomePage />
}

/** One key per destination, so switching sections animates but typing does not. */
function routeKey(route: ReturnType<typeof useNavigation>['route']): string {
  switch (route.kind) {
    case 'chat':
      return `chat:${route.conversationId}`
    case 'project':
      return `project:${route.projectId}`
    case 'settings':
      return 'settings'
    default:
      return 'home'
  }
}
