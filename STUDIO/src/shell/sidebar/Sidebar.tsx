import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE, DURATION, EASE_OUT, SHELL, SPRING_PANEL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { StudioMark } from '@/components/brand'
import { IconButton, NavRow, Tooltip } from '@/components/primitives'
import { ConversationRow } from '@/shell/sidebar/ConversationRow'
import { ProjectSection } from '@/shell/sidebar/ProjectSection'
import { SettingsTree } from '@/shell/sidebar/SettingsTree'
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
 * The left column holds where you can go, one list at a time. On the app
 * surfaces that list is conversations and projects. On the settings route the
 * same column shows the settings tree instead -- same width, same ground, same
 * brand band, same drag region -- because Settings' navigation lives there too,
 * and a second list beside the first was the two-column mistake this app
 * already tried and untried. The swap and its rules are recorded on
 * `SettingsTree`; the open/close state that makes room for it is kept in the
 * navigation store beside `sidebarOpen` itself.
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
    route,
    toggleSidebar,
    goHome,
    openSettings,
    leaveSettings,
    setPaletteOpen,
  } = useNavigation()
  const { projects, conversations, storePhase, ensureStore } = useWorkspace()
  const [sectionOpen, setSectionOpen] = useState(true)

  const inSettings = route.kind === 'settings'
  const activeSection = inSettings ? route.sectionId : ''

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
        // because 236px out of a 620px window leaves the transcript thinner
        // than the sidebar beside it — a split that makes the conversation the
        // smaller half of its own screen.
        animate={
          compact
            ? { x: sidebarOpen ? 0 : -SHELL.sidebar.expandedWidth, width: SHELL.sidebar.expandedWidth }
            : { x: 0, width: sidebarOpen ? SHELL.sidebar.expandedWidth : 0 }
        }
        transition={SPRING_PANEL}
        onAnimationStart={() => onReflow?.(true)}
        onAnimationComplete={() => onReflow?.(false)}
        // The border goes with the width when it collapses: left on, a closed
        // sidebar leaves a 1px rule down the edge of the window — the ghost of
        // a panel that is supposed to be gone. Floating, it always has an edge,
        // because it always has content beside it.
        // Only while floating. Resident, the sidebar has no edge of its own:
        // the page's rounded corner is the edge, and the sunken ground shows
        // through the notch it cuts. A hairline there drew a straight rule
        // across the arc — the corner rounded on one side of the line and the
        // panel stopped square on the other, which is the "it is round but the
        // sidebar does not follow it" seam. Floating over the page it still
        // needs one, because then it genuinely is a separate object.
        style={{ borderRightWidth: compact ? 1 : 0 }}
        className={cn(
          // Square. The sidebar is the ground the window is built on; the page
          // is the object sitting on it, and the page is what carries the
          // radius. See the note in `AppShell`.
          'h-full overflow-hidden border-r bg-surface-sunken',
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
        {/* The brand: mark and wordmark, occupying the top strip's own band.
            The serif appears exactly twice in the chrome — here and on dialog
            headers — so the wordmark says "this is Studio" and nothing else
            on the page competes for that voice.

            The height is the strip's height, not padding chosen by eye. The
            strip only spans the main column, so this band used to be reserved
            by an equal `paddingTop` on the column and then left empty — the
            brand sat below the window controls rather than beside them, and the
            first thing at the top of the window was nothing. Sharing the one
            number puts the wordmark, the traffic lights and the panel toggle on
            a single line, and keeps them there if the strip is ever retuned.

            While Settings is the route, the band's right end carries the way
            back: one icon, on the same line as the brand and the window
            controls, at the edge of the column it is about to leave. Back is a
            window-level move, but it is made *from* this column — the tree it
            leaves lives here — so the control sits on the band rather than in
            the strip over the page, where it would read as page furniture. */}
        {/* This band is title bar: the window's top edge on the sidebar's side,
            and a frameless window whose most handle-shaped strip does not move
            it is one people try to drag and then give up on. Selection is off
            for the same reason — dragging a title bar should move the window,
            not highlight the brand.

            Dragging goes through `startWindowDrag` rather than
            `data-tauri-drag-region`, and the difference matters: the attribute
            also toggles maximize on double-click, and this app's rounded corner
            is a DWM attribute that Windows drops for any maximized window. One
            stray double-click on the logo turned the whole panel square, with
            nothing in the CSS to explain it. Maximizing lives in the traffic
            lights, where it is deliberate. The target guard keeps that contract
            intact now that the band holds a control: the drag belongs to the
            empty band, never to a child of it. */}
        <div
          onPointerDown={(event) => {
            if (event.button !== 0 || event.target !== event.currentTarget) return
            void startWindowDrag()
          }}
          className="flex shrink-0 items-center justify-between gap-1.5 px-3.5 select-none"
          style={{ height: SHELL.topStrip.height }}
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <StudioMark size={16} className="pointer-events-none text-foreground" />
            <span className="studio-heading pointer-events-none text-foreground">Studio</span>
          </div>

          {inSettings ? (
            <IconButton label="Back" tooltipSide="bottom" onClick={leaveSettings}>
              <Icons.back size="md" />
            </IconButton>
          ) : null}
        </div>

        {/* Spacing in this column separates things that are different in kind,
            not merely adjacent. The two standing actions sit closer to each
            other than to the list below them, and the list's groups sit further
            apart than the rows inside a group — so the eye gets the hierarchy
            from the gaps before it reads a single title.

            In Settings the slot is empty on purpose. The way back moved up into
            the brand band; the slot itself stays so the tree begins at the same
            height on every route, and a list that swaps in place never jumps
            because of the swap. */}
        <div className="mt-1 flex shrink-0 flex-col gap-1 px-2 pb-5">
          {inSettings ? null : (
            <>
              <Action label="New conversation" icon={<Icons.newChat />} onClick={goHome} />
              <Action
                label="Search"
                hint="Ctrl K"
                icon={<Icons.command />}
                onClick={() => setPaletteOpen(true)}
              />
            </>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {inSettings ? (
            <SettingsTree active={activeSection} onSelect={(sectionId) => openSettings(sectionId)} />
          ) : (
            <>
              {/* A store that cannot be read says so, above the column it
                  failed -- the note is the column's state, and the rows below
                  it are whatever local rows exist. The loading state lives
                  further down, holding the rows' own place. The states and
                  their argument live in `SidebarStates`. */}
              {storePhase.status === 'no-harness' || storePhase.status === 'failed' ? (
                <SidebarUnavailable phase={storePhase} onEnsure={ensureStore} />
              ) : null}

              <div className="group/section flex items-center gap-0.5 px-1 pt-1.5 pb-1">
                <button
                  type="button"
                  onClick={() => setSectionOpen((value) => !value)}
                  aria-expanded={sectionOpen}
                  className="flex min-w-0 flex-1 items-center gap-1 rounded text-micro uppercase text-muted-foreground/80 transition-colors duration-fast hover:text-muted-foreground"
                >
                  {/* Sized `sm`, not from its own text. Marks size at 1.1em of the
                      text beside them, and this header is `micro` while the project
                      rows under it are `ui` — so the parent's arrow came out
                      *smaller* than its children's, which inverts the hierarchy the
                      arrows exist to express. A disclosure belongs to the tree, not
                      to the label it happens to sit next to. */}
                  <Icons.disclosure state={sectionOpen ? 'on' : 'rest'} size="sm" />
                  Projects
                </button>

                {/* The row's last control, at its far end: the only action the
                    header carries now that the options menu is gone. */}
                <Tooltip label="New project">
                  <button
                    type="button"
                    aria-label="New project"
                    onClick={onNewProject}
                    className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground/80 transition-colors duration-fast hover:bg-tint"
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
                    ) : (
                      <div className="flex flex-col gap-3">
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
                  <p className="px-1.5 pt-5 pb-1.5 text-micro text-muted-foreground/80 uppercase">
                    Conversations
                  </p>
                  <div className="flex flex-col gap-1">
                    {loose.map((conversation) => (
                      <ConversationRow key={conversation.id} conversation={conversation} />
                    ))}
                  </div>
                </>
              ) : null}
            </>
          )}
        </div>

        {/* No rule above it. The gap already separates this from the list --
            a footer pinned to the bottom of a column reads as a footer without
            being underlined, and the line was one more piece of furniture in a
            panel whose whole job is to be quiet. Position does the work.

            It is also conversation-column furniture: Account and the settings
            shortcut are both rows in the settings tree already, so while the
            tree is what this column holds, the footer would be a second copy
            of destinations the column is showing. */}
        {inSettings ? null : (
          <div className="flex shrink-0 items-center justify-between px-2 pt-3 pb-2">
            <NavRow icon={<Icons.account />} className="min-w-0" onClick={() => openSettings('account')}>
              <span className="truncate">Account</span>
            </NavRow>

            <IconButton label="Settings" onClick={() => openSettings()}>
              <Icons.settings size="md" />
            </IconButton>
          </div>
        )}
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
    <NavRow icon={icon} onClick={onClick}>
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
