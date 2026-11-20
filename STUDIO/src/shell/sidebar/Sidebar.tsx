import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion, useIsPresent, useReducedMotion, type Variants } from 'framer-motion'
import { COLLAPSE, DURATION, EASE_OUT, PANEL_VIEW_TRANSITION, RADIUS, SHELL, SPRING_PANEL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { StudioMark } from '@/components/brand'
import { IconButton, NavRow, Tooltip } from '@/components/primitives'
import { ConversationRow } from '@/shell/sidebar/ConversationRow'
import { ProjectSection } from '@/shell/sidebar/ProjectSection'
import { SettingsNav } from '@/features/settings/SettingsNav'
import { SidebarLoading, SidebarUnavailable } from '@/shell/sidebar/SidebarStates'
import { startWindowDrag } from '@/platform/tauri'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * How far `--shadow-panel` (8px 0 28px -12px) reaches past the floating
 * column's right edge: 8 offset - 12 spread + 28 blur = 24, rounded up.
 *
 * The closed floating column is parked off screen, but its shadow is not part
 * of its box. Parked exactly one width to the left, its right edge sat on the
 * window's left edge and the shadow it casts onto the page stayed on screen as
 * a dark smudge down the left side. Parking it this much further hides the
 * shadow with the column. Keep it in step with `--shadow-panel` in tokens.css.
 */
const PANEL_SHADOW_REACH = 32

/**
 * The sidebar.
 *
 * ---- What the column is ---------------------------------------------------
 *
 * The left column holds where you can go, one list at a time. On the app
 * surfaces that list is conversations and projects. On the settings route the
 * same column shows the settings tree instead -- same width, same ground, same
 * drag region -- because Settings' navigation lives there too, and a second
 * list beside the first was the two-column mistake this app already tried and
 * untried. The page beside it is only the selected pane.
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
 * Closing the sidebar takes Settings off screen with it. That is acceptable only
 * because it is not lost: the toggle sits in the strip, Ctrl B brings the column
 * back, Ctrl K reaches every destination by name, and Ctrl , opens Settings
 * directly -- which opens the column with it, since the column is where
 * Settings' own navigation lives. If any of those went away the rail would have
 * to come back.
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
    route,
    toggleSidebar,
    goHome,
    openSettings,
    leaveSettings,
    setPaletteOpen,
  } = useNavigation()
  const { projects, conversations, storePhase, ensureStore } = useWorkspace()
  const [sectionOpen, setSectionOpen] = useState(true)
  const reducedMotion = useReducedMotion()

  const inSettings = route.kind === 'settings'
  const activeSection = route.kind === 'settings' ? route.sectionId : 'general'

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
            ? { x: sidebarOpen ? 0 : -(SHELL.sidebar.expandedWidth + PANEL_SHADOW_REACH), width: SHELL.sidebar.expandedWidth }
            : { x: 0, width: sidebarOpen ? SHELL.sidebar.expandedWidth : 0 }
        }
        transition={changingWhileClosed || reducedMotion ? { duration: 0 } : SPRING_PANEL}
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
        className="relative flex h-full flex-col overflow-hidden"
        style={{ width: SHELL.sidebar.expandedWidth }}
      >
        {/* The column holds one list at a time. Both views are keyed and sit in
            the same box, so entering or leaving Settings is a short crossfade
            with a hint of travel -- the old list leaves the way the new one
            arrives, and neither the width nor the rest of the window moves. */}
        <AnimatePresence initial={false} custom={inSettings}>
          {inSettings ? (
            <SidebarView key="settings" settings>
              <SettingsNav
                variant="sidebar"
                active={activeSection}
                onSelect={(sectionId) => openSettings(sectionId)}
                onBack={leaveSettings}
              />
            </SidebarView>
          ) : (
            <SidebarView key="app" settings={false}>
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
                  <StudioMark size={16} className="pointer-events-none" />
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
              </div>

              {/* No rule above it. The gap already separates this from the list --
                  a footer pinned to the bottom of a column reads as a footer without
                  being underlined, and the line was one more piece of furniture in a
                  panel whose whole job is to be quiet. Position does the work.

                  The account shortcut is deliberately absent. Account is not in
                  use yet, and the settings tree already carries it for the one
                  place it is still relevant. The settings control stays, because
                  it is how this column hands over to that tree. */}
              <div className="flex shrink-0 items-center justify-end px-2 pt-3 pb-2">
                <IconButton label="Settings" onClick={() => openSettings()}>
                  <Icons.settings size="md" />
                </IconButton>
              </div>
            </SidebarView>
          )}
        </AnimatePresence>
      </div>
      </motion.aside>
    </>
  )
}

/**
 * One of the column's two views.
 *
 * Absolute in the same box so the outgoing and incoming lists overlap for the
 * length of the handover rather than pushing each other around. Eight pixels of
 * travel is enough to say which way the column changed without turning a list
 * swap into a page transition; the opacity is the house fade. `custom` is the
 * destination -- Settings or the app surfaces -- so the exit and entrance read
 * as the two halves of one move even while `AnimatePresence` freezes the
 * leaving element's other props.
 */
const SIDEBAR_VIEW: Variants = {
  initial: (settings: boolean) => ({ opacity: 0, x: settings ? 8 : -8 }),
  animate: { opacity: 1, x: 0 },
  exit: (settings: boolean) => ({ opacity: 0, x: settings ? -8 : 8 }),
}

function SidebarView({ settings, children }: { settings: boolean; children: ReactNode }) {
  const present = useIsPresent()

  return (
    <motion.div
      custom={settings}
      variants={SIDEBAR_VIEW}
      initial="initial"
      animate="animate"
      exit="exit"
      transition={PANEL_VIEW_TRANSITION}
      inert={!present}
      aria-hidden={present ? undefined : true}
      className="absolute inset-0 flex flex-col"
    >
      {children}
    </motion.div>
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
        <kbd className="shrink-0 rounded-xs border px-1 py-0.5 text-micro text-muted-foreground/70">
          {hint}
        </kbd>
      ) : null}
    </NavRow>
  )
}
