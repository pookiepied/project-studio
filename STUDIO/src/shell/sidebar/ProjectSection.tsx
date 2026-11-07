import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { MenuItem, MenuSeparator, NavRow, Popover, SelectionChip } from '@/components/primitives'
import { ProjectIconMark } from '@/features/projects'
import { ConversationRow } from '@/shell/sidebar/ConversationRow'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import type { Project } from '@/domain/projects/types'
import type { Conversation } from '@/domain/conversation/types'
import { cn } from '@/lib/cn'

/** How many conversations a project shows before it offers the rest. */
const VISIBLE_CONVERSATIONS = 5

/**
 * A project and the conversations inside it.
 *
 * One mark per row at rest: the project's own, which the person chose. The
 * disclosure stays out of the way at the far end, shown on hover and whenever the
 * project is closed, since a closed project is the state worth saying out loud.
 * Conversation titles sit under the project's name, so the column reads as a
 * parent and its children by alignment alone.
 *
 * A long project stops at `VISIBLE_CONVERSATIONS`, so one busy project cannot
 * push the others out of the column. The open conversation is never hidden by it.
 */
export function ProjectSection({
  project,
  conversations,
}: {
  project: Project
  conversations: readonly Conversation[]
}) {
  const { route, openProject } = useNavigation()
  const { removeProject } = useWorkspace()
  const [open, setOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [showingAll, setShowingAll] = useState(false)

  const active = route.kind === 'project' && route.projectId === project.id
  const openHere = conversations.findIndex(
    (conversation) => route.kind === 'chat' && route.conversationId === conversation.id,
  )
  const showAll = showingAll || openHere >= VISIBLE_CONVERSATIONS
  const shown = showAll ? conversations : conversations.slice(0, VISIBLE_CONVERSATIONS)
  const hidden = conversations.length - VISIBLE_CONVERSATIONS

  return (
    <div>
      <div
        className={cn(
          'group/project relative flex items-center gap-1 rounded-md pr-0.5 transition-colors duration-fast',
          active ? null : 'hover:bg-tint',
        )}
      >
        {active ? <SelectionChip list="sidebar" /> : null}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="studio-control-flat relative flex min-w-0 flex-1 items-center gap-2 pl-2 text-left"
        >
          <ProjectIconMark icon={project.icon} className="shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate text-ui text-foreground">{project.name}</span>
          <Icons.disclosure
            state={open ? 'on' : 'rest'}
            size="sm"
            className={cn(
              'shrink-0 text-muted-foreground transition-opacity duration-fast',
              open && 'opacity-0 group-hover/project:opacity-100 group-focus-within/project:opacity-100',
            )}
          />
        </button>

        <Popover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          side="bottom"
          align="end"
          trigger={
            <button
              type="button"
              aria-label="Project options"
              onClick={() => setMenuOpen((value) => !value)}
              className={cn(
                'relative flex size-[var(--control-xs)] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-fast hover:bg-tint',
                menuOpen ? 'opacity-100' : 'opacity-0 group-hover/project:opacity-100',
              )}
            >
              <Icons.more />
            </button>
          }
        >
          <MenuItem
            icon={<Icons.projectOpen />}
            onSelect={() => {
              setMenuOpen(false)
              openProject(project.id)
            }}
          >
            Open project
          </MenuItem>
          <MenuItem icon={<Icons.copy />} onSelect={() => setMenuOpen(false)}>
            Copy working directory
          </MenuItem>

          <MenuSeparator />
          <MenuItem
            icon={<Icons.delete />}
            destructive
            // The wording is the safeguard. "Remove" alone reads as delete to
            // anyone moving quickly, and the one thing they need to know is
            // that the folder on disk is untouched.
            note="Keeps the folder on disk. Conversations stay."
            onSelect={() => {
              setMenuOpen(false)
              removeProject(project.id)
            }}
          >
            Remove from Studio
          </MenuItem>
        </Popover>
      </div>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div {...COLLAPSE} className="overflow-hidden">
            <div className="mt-0.5 ml-6 flex flex-col gap-0.5">
              {conversations.length === 0 ? (
                <p className="px-2 py-1 text-caption text-muted-foreground/70">No conversations</p>
              ) : (
                shown.map((conversation) => (
                  <ConversationRow key={conversation.id} conversation={conversation} />
                ))
              )}
              {hidden > 0 && openHere < VISIBLE_CONVERSATIONS ? (
                <NavRow className="text-caption" onClick={() => setShowingAll((value) => !value)}>
                  {showingAll ? 'Show less' : `Show ${hidden} more`}
                </NavRow>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
