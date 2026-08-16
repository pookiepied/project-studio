import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE, SHELL, SPRING_PANEL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { StudioMark } from '@/components/brand'
import { IconButton, MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from '@/components/primitives'
import { ConversationRow } from '@/shell/sidebar/ConversationRow'
import { ProjectSection } from '@/shell/sidebar/ProjectSection'
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
  const {
    sidebarOpen,
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
    <motion.aside
      // The border animates away with the width. Left on, a closed sidebar
      // leaves a 1px rule down the edge of the window -- the ghost of a panel
      // that is supposed to be gone.
      animate={{
        width: sidebarOpen ? SHELL.sidebar.expandedWidth : 0,
        borderRightWidth: sidebarOpen ? 1 : 0,
      }}
      transition={SPRING_PANEL}
      className="relative z-20 h-full shrink-0 overflow-hidden border-r bg-surface-sunken"
      style={{ paddingTop: SHELL.topStrip.height }}
    >
      {/* `inert` while closed. A hidden column that still takes Tab is worse
          than a visible one: focus disappears into a panel nobody can see. */}
      <div
        inert={!sidebarOpen}
        className="flex h-full flex-col"
        style={{ width: SHELL.sidebar.expandedWidth }}
      >
        {/* The brand: mark and wordmark, above everything the sidebar does.
            The serif appears exactly twice in the chrome -- here and on dialog
            headers -- so the wordmark says "this is Studio" and nothing else
            on the page competes for that voice. */}
        <div className="flex shrink-0 items-center gap-1.5 px-3.5 pt-0.5 pb-2">
          <StudioMark size={17} className="text-foreground" />
          <span className="studio-heading text-foreground">Studio</span>
        </div>

        {/* Spacing in this column separates things that are different in kind,
            not merely adjacent. The two standing actions sit closer to each
            other than to the list below them, and the list's groups sit further
            apart than the rows inside a group -- so the eye gets the hierarchy
            from the gaps before it reads a single title. */}
        <div className="flex shrink-0 flex-col gap-1 px-2 pb-4">
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
              className="flex min-w-0 flex-1 items-center gap-1 rounded text-micro uppercase text-muted-foreground/80 transition-colors duration-150 hover:text-muted-foreground"
            >
              <Icons.disclosure
                state={sectionOpen ? 'on' : 'rest'}
                className="shrink-0"
              />
              {flat ? 'Conversations' : 'Projects'}
            </button>

            {flat ? null : (
              <Tooltip label="New project">
                <button
                  type="button"
                  aria-label="New project"
                  onClick={onNewProject}
                  className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/80 transition-colors duration-150 hover:bg-tint hover:text-foreground"
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
                    'flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-opacity duration-150 hover:text-foreground',
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

        <div className="flex shrink-0 items-center justify-between border-t px-2 py-2">
          <button
            type="button"
            onClick={() => openSettings('account')}
            className="flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-150 hover:bg-tint hover:text-foreground"
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
      className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-ui text-muted-foreground transition-colors duration-150 hover:bg-tint hover:text-foreground"
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
