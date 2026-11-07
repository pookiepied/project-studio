import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE, DURATION, EASE_OUT, RADIUS, SHELL, SPRING_PANEL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { StudioMark } from '@/components/brand'
import { IconButton, NavRow, Tooltip } from '@/components/primitives'
import { ConversationRow } from '@/shell/sidebar/ConversationRow'
import { ProjectSection } from '@/shell/sidebar/ProjectSection'
import { SidebarLoading, SidebarUnavailable } from '@/shell/sidebar/SidebarStates'
import { startWindowDrag } from '@/platform/tauri'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * The sidebar.
 *
 * ---- What the column is ---------------------------------------------------
 *
 * The left column holds conversations and projects, on every route. Settings
 * carries its own section list inside its page (see `SettingsNav`), because at
 * Studio's default window size this column is a drawer, and a settings list
 * kept here was out of sight on the page that needed it.
 *
 * ---- One state, not two ---------------------------------------------------
 *
 * Open, or gone. There is no icon rail.
 *
 * A rail looks like a compromise that keeps navigation reachable, and it is
 * really a third thing to design and a permanent 52px tax on the window. It
 * cannot show a conversation title, so it shows marks whose meaning has to be
 * learned, and it leaves the app with two navigation surfaces that disagree
 * about how much they will tell you. Collapsing to a strip of unexplained
 * glyphs is not a quieter interface — it is the same interface with the words
 * removed.
 *
 * Closed, the window is the conversation and nothing else, which is the point
 * of the whole app.
 *
 * ---- What that costs, and why it is paid ---------------------------------
 *
 * Closing the sidebar takes Account and Settings off screen with it. That is
 * acceptable only because neither is lost: the toggle sits in the strip, Ctrl B
 * brings the column back, Ctrl K reaches every destination by name, and Ctrl ,
 * opens Settings directly -- which now opens the column with it, since the
 * column is where Settings' own navigation lives. If any of those went away the
 * rail would have to come back.
 *
 * ---- Why the inner column is a fixed width -------------------------------
 *
 * The `aside` animates its width; the column inside keeps its own. Without
 * that, every row would reflow on each frame of the animation — titles
 * re-truncating, rows re-wrapping — which is both visibly noisy and the
 * expensive kind of layout work. Fixed inside a clipping parent means the
 * column is simply revealed, and nothing inside it is asked to re-measure.
 */
export function Sidebar({
  open: sidebarOpen,
  compact,
  onNewProject,
  onReflow,
}: {
  /**
   * Whether the column is on screen.
   *
   * Handed in by the shell rather than read from the navigation store,
   * because the two are not always the same thing: while the rail is on its
   * way out the store already says open and the column waits, so that the
   * two moves happen in order (`panelHandover`). The store is still where
   * the toggles go; this is only what is drawn.
   */
  open: boolean
  /** Whether the column floats over the page rather than taking space from it. */
  compact: boolean
  onNewProject: () => void
  /**
   * Called as the width spring starts and ends, so the page can spend the
   * move in cheap layout -- see `AppShell`, which holds the class and also
   * reads the end as the column having settled.
   */
  onReflow?: (moving: boolean) => void
}) {
  const {
    toggleSidebar,
    goHome,
    openSettings,
    setPaletteOpen,
  } = useNavigation()
  const { projects, conversations, storePhase, ensureStore } = useWorkspace()
  const [sectionOpen, setSectionOpen] = useState(true)

  /**
   * A closed column changing layout mode does not move. The two modes hold
   * a closed column differently - floating, it is full width and pushed off
   * screen; resident, it is in the row at no width - and the spring between
   * them, played on a column nobody can see, was not invisible: it entered
   * the row at its full width and shrank, and the page beside it was
   * squeezed for the length of the move. That is the breakpoint flipping as
   * the rail leaves, at widths where the rail alone made the window
   * compact. Only an open-or-close is a motion; a mode change while closed
   * is a jump.
   */
  const wasOpen = useRef(sidebarOpen)
  const changingWhileClosed = !sidebarOpen && !wasOpen.current
  useEffect(() => {
    wasOpen.current = sidebarOpen
  }, [sidebarOpen])

  const live = conversations.filter((conversation) => !conversation.archived)
  const sorted = [...live].sort((a, b) => {
    // Pinned conversations stay ahead of everything else; the rest is
    // recency, most recently updated first.
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return b.updatedAt - a.updatedAt
  })
  const loose = sorted.filter((conversation) => conversation.projectId === null)

  return (
    <>
      {/* Narrow windows get a scrim, because a floating column over live content
          has to say the content behind it is not the thing being used. It is
          also the dismissal target: on a small window the quickest way out of a
          panel is a tap beside it, not finding the toggle again. */}
      <AnimatePresence>
        {compact && sidebarOpen ? (
          <motion.button
            type="button"
            aria-label="Close sidebar"
            onClick={toggleSidebar}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
            className="absolute inset-0 z-20 bg-scrim"
          />
        ) : null}
      </AnimatePresence>

      <motion.aside
        // Two layouts, one component. Wide, the column is part of the row and
        // animates its width, so the page is genuinely narrower while it is
        // open. Narrow, it leaves the flow entirely and slides over the page,
        // because a full column out of a 620px window leaves the transcript thinner
        // than the sidebar beside it — a split that makes the conversation the
        // smaller half of its own screen.
        animate={
          compact
            ? { x: sidebarOpen ? 0 : -SHELL.sidebar.expandedWidth, width: SHELL.sidebar.expandedWidth }
            : { x: 0, width: sidebarOpen ? SHELL.sidebar.expandedWidth : 0 }
        }
        transition={changingWhileClosed ? { duration: 0 } : SPRING_PANEL}
        onAnimationStart={() => onReflow?.(true)}
        onAnimationComplete={() => onReflow?.(false)}
        // Two different objects, so two different edges. Wide, the column is
        // the ground the window is built on - square, no edge of its own; the
        // page is the object sitting on it, and the page carries the radius.
        // Floating, the roles invert: the column is the object resting on the
        // page, and an object carries the design language's own rounding on
        // the edge it is rested against, with elevation doing the separating
        // a hairline would otherwise fake. A hairline under a radius draws a
        // straight rule across the arc - the same seam the page's own corner
        // docblock in `AppShell` refuses - so the border stays with the
        // resident layout that has a straight edge to draw it on.
        style={{
          ...(compact
            ? {
                borderTopRightRadius: RADIUS.xl,
                borderBottomRightRadius: RADIUS.xl,
              }
            : { borderRightWidth: 0 }),
        }}
        className={cn(
          'h-full overflow-hidden bg-surface-sunken',
          compact ? 'absolute inset-y-0 left-0 z-30 shadow-panel' : 'relative z-20 shrink-0',
        )}
      >
      {/* `inert` while closed. A hidden column that still takes Tab is worse
          than a visible one: focus disappears into a panel nobody can see. */}
      <div
        inert={!sidebarOpen}
        className="flex h-full flex-col"
        style={{ width: SHELL.sidebar.expandedWidth }}
      >
        {/* The brand, on the top strip's own band, so the wordmark and the strip's
            controls share one line. It is title bar too: a frameless window whose
            most handle-shaped strip does not move it is one people try to drag and
            give up on. `startWindowDrag` rather than `data-tauri-drag-region`,
            because the attribute also toggles maximize on double-click. */}
        <div
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target !== event.currentTarget) return
            void startWindowDrag()
          }}
          className="flex shrink-0 items-center justify-between gap-1.5 px-4 select-none"
          style={{ height: SHELL.topStrip.height }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <StudioMark size={16} className="pointer-events-none text-foreground" />
            <span className="studio-heading pointer-events-none text-foreground">Studio</span>
          </div>

        </div>

        {/* Spacing in this column separates things that are different in kind,
            not merely adjacent. The two standing actions sit closer to each
            other than to the list below them, and the list's groups sit further
            apart than the rows inside a group — so the eye gets the hierarchy
            from the gaps before it reads a single title. */}
        <div className="mt-1 flex shrink-0 flex-col gap-0.5 px-2 pb-4">
          <Action label="New conversation" icon={<Icons.newChat />} onClick={goHome} />
          <Action
            label="Search"
            hint="Ctrl K"
            icon={<Icons.command />}
            onClick={() => setPaletteOpen(true)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
            <>
              {/* A store that cannot be read says so, above the column it
                  failed -- the note is the column's state, and the rows below
                  it are whatever local rows exist. The loading state lives
                  further down, holding the rows' own place. The states and
                  their argument live in `SidebarStates`. */}
              {storePhase.status === 'no-harness' || storePhase.status === 'failed' ? (
                <SidebarUnavailable phase={storePhase} onEnsure={ensureStore} />
              ) : null}

              <div className="group/section flex items-center gap-0.5 pr-0.5 pl-2 pb-1">
                <button
                  type="button"
                  onClick={() => setSectionOpen((value) => !value)}
                  aria-expanded={sectionOpen}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded text-caption text-muted-foreground transition-colors duration-fast hover:text-foreground"
                >
                  Projects
                  <Icons.disclosure
                    state={sectionOpen ? 'on' : 'rest'}
                    size="sm"
                    className={cn(
                      'transition-opacity duration-fast',
                      sectionOpen && 'opacity-0 group-hover/section:opacity-100 group-focus-within/section:opacity-100',
                    )}
                  />
                </button>

                {/* The row's last control, at its far end: the only action the
                    header carries now that the options menu is gone. */}
                <Tooltip label="New project">
                  <button
                    type="button"
                    aria-label="New project"
                    onClick={onNewProject}
                    className="flex size-[var(--control-xs)] shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition-colors duration-fast hover:bg-tint"
                  >
                    <Icons.projectNew />
                  </button>
                </Tooltip>
              </div>

              <AnimatePresence initial={false}>
                {sectionOpen ? (
                  <motion.div {...COLLAPSE} className="overflow-hidden">
                    {storePhase.status === 'loading' ? (
                      // The wait, where the rows will be. Above the header
                      // would be a state claiming to be the column; in here
                      // it is only the list holding its own place.
                      <SidebarLoading />
                    ) : projects.length === 0 ? (
                      <NavRow icon={<Icons.projectNew />} className="w-full" onClick={onNewProject}>
                        Add a project
                      </NavRow>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {projects.map((project) => (
                          <ProjectSection
                            key={project.id}
                            project={project}
                            conversations={sorted.filter(
                              (conversation) => conversation.projectId === project.id,
                            )}
                          />
                        ))}
                      </div>
                    )}
                  </motion.div>
                ) : null}
              </AnimatePresence>

              {loose.length > 0 ? (
                <>
                  <p className="px-2 pt-5 pb-1 text-caption text-muted-foreground">Conversations</p>
                  <div className="flex flex-col gap-0.5">
                    {loose.map((conversation) => (
                      <ConversationRow key={conversation.id} conversation={conversation} />
                    ))}
                  </div>
                </>
              ) : null}
            </>
        </div>

        {/* No rule above it. The gap already separates this from the list --
            a footer pinned to the bottom of a column reads as a footer without
            being underlined, and the line was one more piece of furniture in a
            panel whose whole job is to be quiet. Position does the work. */}
        <div className="flex shrink-0 items-center justify-between px-2 pt-3 pb-2">
          <NavRow icon={<Icons.account />} className="min-w-0" onClick={() => openSettings('account')}>
            <span className="truncate">Account</span>
          </NavRow>

          <IconButton label="Settings" onClick={() => openSettings()}>
            <Icons.settings size="md" />
          </IconButton>
        </div>
        </div>
      </motion.aside>
    </>
  )
}

function Action({
  label,
  hint,
  icon,
  onClick,
}: {
  label: string
  hint?: string
  icon: ReactNode
  onClick: () => void
}) {
  return (
    <NavRow icon={icon} className="gap-2" onClick={onClick}>
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {hint ? (
        // A keychord, drawn as the key itself: a chip, not plain text, so it
        // reads as something you press rather than something you read.
        <kbd className="shrink-0 rounded-xs border px-1 py-0.5 font-sans text-micro text-muted-foreground/70">
          {hint}
        </kbd>
      ) : null}
    </NavRow>
  )
}
