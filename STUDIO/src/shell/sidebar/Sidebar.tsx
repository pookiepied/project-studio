import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE, DURATION, EASE_OUT, SHELL, SPRING_PANEL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { StudioMark } from '@/components/brand'
import { IconButton, MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from '@/components/primitives'
import { ConversationRow } from '@/shell/sidebar/ConversationRow'
import { ProjectSection } from '@/shell/sidebar/ProjectSection'
import { startWindowDrag } from '@/platform/tauri'
import { useCompactLayout } from '@/shell/useCompactLayout'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * The sidebar.
 *
 * ---- One state, not two --------------------------------------------------
 *
 * Open, or gone. There is no icon rail.
 *
 * A rail looks like a compromise that keeps navigation reachable, and it is
 * really a third thing to design and a permanent 52px tax on the window. It
 * cannot show a conversation title, so it shows marks whose meaning has to be
 * learned, and it leaves the app with two navigation surfaces that disagree
 * about how much they will tell you. Collapsing to a strip of unexplained
 * glyphs is not a quieter interface -- it is the same interface with the words
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
 * opens Settings directly. If any of those went away the rail would have to
 * come back.
 *
 * ---- Why the inner column is a fixed width -------------------------------
 *
 * The `aside` animates its width; the column inside keeps its own. Without
 * that, every row would reflow on each frame of the animation -- titles
 * re-truncating, rows re-wrapping -- which is both visibly noisy and the
 * expensive kind of layout work. Fixed inside a clipping parent means the
 * column is simply revealed, and nothing inside it is asked to re-measure.
 */
export function Sidebar({ onNewProject }: { onNewProject: () => void }) {
  const compact = useCompactLayout()
  const {
    sidebarOpen,
    toggleSidebar,
    goHome,
    openSettings,
    setPaletteOpen,
    sidebarOrganize,
    sidebarSort,
    setSidebarOrganize,
    setSidebarSort,
  } = useNavigation()
  const { projects, conversations } = useWorkspace()
  const [sectionOpen, setSectionOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  const flat = sidebarOrganize === 'list'
  const live = conversations.filter((conversation) => !conversation.archived)
  const sorted = [...live].sort((a, b) => {
    // Manual order is the order the data was given in, untouched. Priority
    // keeps pinned conversations ahead of everything else; last updated is
    // recency alone and lets a pin lose to a fresher chat.
    if (sidebarSort === 'manual') return 0
    if (sidebarSort === 'priority' && a.pinned !== b.pinned) return a.pinned ? -1 : 1
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
        // than the sidebar beside it -- a split that makes the conversation the
        // smaller half of its own screen.
        animate={
          compact
            ? { x: sidebarOpen ? 0 : -SHELL.sidebar.expandedWidth, width: SHELL.sidebar.expandedWidth }
            : { x: 0, width: sidebarOpen ? SHELL.sidebar.expandedWidth : 0 }
        }
        transition={SPRING_PANEL}
        // The border goes with the width when it collapses: left on, a closed
        // sidebar leaves a 1px rule down the edge of the window -- the ghost of
        // a panel that is supposed to be gone. Floating, it always has an edge,
        // because it always has content beside it.
        // Only while floating. Resident, the sidebar has no edge of its own:
        // the page's rounded corner is the edge, and the sunken ground shows
        // through the notch it cuts. A hairline there drew a straight rule
        // across the arc -- the corner rounded on one side of the line and the
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
            The serif appears exactly twice in the chrome -- here and on dialog
            headers -- so the wordmark says "this is Studio" and nothing else
            on the page competes for that voice.

            The height is the strip's height, not padding chosen by eye. The
            strip only spans the main column, so this band used to be reserved
            by an equal `paddingTop` on the column and then left empty -- the
            brand sat below the window controls rather than beside them, and the
            first thing at the top of the window was nothing. Sharing the one
            number puts the wordmark, the traffic lights and the panel toggle on
            a single line, and keeps them there if the strip is ever retuned. */}
        {/* This band is title bar: the window's top edge on the sidebar's side,
            and a frameless window whose most handle-shaped strip does not move
            it is one people try to drag and then give up on. Selection is off
            for the same reason -- dragging a title bar should move the window,
            not highlight the brand.

            Dragging goes through `startWindowDrag` rather than
            `data-tauri-drag-region`, and the difference matters: the attribute
            also toggles maximize on double-click, and this app's rounded corner
            is a DWM attribute that Windows drops for any maximized window. One
            stray double-click on the logo turned the whole panel square, with
            nothing in the CSS to explain it. Maximizing lives in the traffic
            lights, where it is deliberate. */}
        <div
          onPointerDown={(event) => {
            if (event.button !== 0) return
            void startWindowDrag()
          }}
          className="flex shrink-0 items-center gap-1.5 px-3.5 select-none"
          style={{ height: SHELL.topStrip.height }}
        >
          <StudioMark size={17} className="pointer-events-none text-foreground" />
          <span className="studio-heading pointer-events-none text-foreground">Studio</span>
        </div>

        {/* Spacing in this column separates things that are different in kind,
            not merely adjacent. The two standing actions sit closer to each
            other than to the list below them, and the list's groups sit further
            apart than the rows inside a group -- so the eye gets the hierarchy
            from the gaps before it reads a single title. */}
        <div className="mt-1 flex shrink-0 flex-col gap-1 px-2 pb-5">
          <Action label="New conversation" icon={<Icons.newChat />} onClick={goHome} />
          <Action
            label="Search"
            hint="Ctrl K"
            icon={<Icons.command />}
            onClick={() => setPaletteOpen(true)}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div className="group/section flex items-center gap-0.5 px-1 pt-1.5 pb-1">
            <button
              type="button"
              onClick={() => setSectionOpen((value) => !value)}
              aria-expanded={sectionOpen}
              className="flex min-w-0 flex-1 items-center gap-1 rounded text-micro uppercase text-muted-foreground/80 transition-colors duration-fast hover:text-muted-foreground"
            >
              {/* Sized `sm`, not from its own text. Marks size at 1.1em of the
                  text beside them, and this header is `micro` while the project
                  rows under it are `ui` -- so the parent's arrow came out
                  *smaller* than its children's, which inverts the hierarchy the
                  arrows exist to express. A disclosure belongs to the tree, not
                  to the label it happens to sit next to. */}
              <Icons.disclosure state={sectionOpen ? 'on' : 'rest'} size="sm" className="shrink-0" />
              {flat ? 'Conversations' : 'Projects'}
            </button>

            {flat ? null : (
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
            )}

            <Popover
              open={menuOpen}
              onOpenChange={setMenuOpen}
              side="bottom"
              align="end"
              trigger={
                <button
                  type="button"
                  aria-label="Sidebar options"
                  onClick={() => setMenuOpen((value) => !value)}
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-tint',
                    menuOpen ? 'opacity-100' : 'opacity-0 group-hover/section:opacity-100',
                  )}
                >
                  <Icons.more />
                </button>
              }
            >
              <MenuLabel>Organize sidebar by</MenuLabel>
              <MenuItem
                selected={sidebarOrganize === 'project'}
                onSelect={() => {
                  setSidebarOrganize('project')
                  setMenuOpen(false)
                }}
              >
                Project
              </MenuItem>
              <MenuItem
                selected={sidebarOrganize === 'list'}
                onSelect={() => {
                  setSidebarOrganize('list')
                  setMenuOpen(false)
                }}
              >
                In a list
              </MenuItem>

              <MenuSeparator />
              <MenuLabel>Sort chats by</MenuLabel>
              <MenuItem
                selected={sidebarSort === 'priority'}
                onSelect={() => {
                  setSidebarSort('priority')
                  setMenuOpen(false)
                }}
              >
                Priority
              </MenuItem>
              <MenuItem
                selected={sidebarSort === 'updated'}
                onSelect={() => {
                  setSidebarSort('updated')
                  setMenuOpen(false)
                }}
              >
                Last updated
              </MenuItem>
              <MenuItem
                selected={sidebarSort === 'manual'}
                onSelect={() => {
                  setSidebarSort('manual')
                  setMenuOpen(false)
                }}
              >
                Manual order
              </MenuItem>
            </Popover>
          </div>

          <AnimatePresence initial={false}>
            {sectionOpen ? (
              <motion.div {...COLLAPSE} className="overflow-hidden">
                {flat ? (
                  <div className="flex flex-col gap-1">
                    {sorted.map((conversation) => (
                      <ConversationRow key={conversation.id} conversation={conversation} />
                    ))}
                  </div>
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

          {!flat && loose.length > 0 ? (
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
        </div>

        {/* No rule above it. The gap already separates this from the list --
            a footer pinned to the bottom of a column reads as a footer without
            being underlined, and the line was one more piece of furniture in a
            panel whose whole job is to be quiet. Position does the work. */}
        <div className="flex shrink-0 items-center justify-between px-2 pt-3 pb-2">
          <button
            type="button"
            onClick={() => openSettings('account')}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
          >
            <Icons.account />
            <span className="truncate">Account</span>
          </button>

          <IconButton label="Settings" onClick={() => openSettings()}>
            <Icons.settings />
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
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
    >
      {icon}
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {hint ? (
        // A keychord, drawn as the key itself: a chip, not plain text, so it
        // reads as something you press rather than something you read.
        <kbd className="shrink-0 rounded-xs border px-1 py-0.5 font-sans text-micro leading-none text-muted-foreground/70">
          {hint}
        </kbd>
      ) : null}
    </button>
  )
}
