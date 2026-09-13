import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { COLLAPSE } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { MenuItem, MenuSeparator, Popover } from '@/components/primitives'
import { ProjectIconMark } from '@/features/projects'
import { ConversationRow } from '@/shell/sidebar/ConversationRow'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import type { Project } from '@/domain/projects/types'
import type { Conversation } from '@/domain/conversation/types'
import { cn } from '@/lib/cn'

/**
 * A project and the conversations inside it.
 *
 * In the rail this is the mark alone, named by a tooltip. That is not a
 * compromise for narrow widths — it is the better version. A mark you learn is
 * faster to find than a name you read, and a column of marks stays quiet in a
 * way a column of truncated names never does.
 */
export function ProjectSection({
  project,
  conversations,
}: {
  project: Project
  conversations: readonly Conversation[]
}) {
  const { openProject } = useNavigation()
  const { removeProject } = useWorkspace()
  const [open, setOpen] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div>
      <div className="group/project flex items-center gap-1 rounded-md pr-0.5 hover:bg-tint">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1.5 py-1 pl-1.5 text-left"
        >
          <Icons.disclosure
            state={open ? 'on' : 'rest'}
            className="shrink-0 text-muted-foreground"
          />
          <ProjectIconMark icon={project.icon} className="text-muted-foreground" />
          <span className="min-w-0 truncate text-ui font-medium text-foreground">{project.name}</span>
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
                'flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-all duration-fast hover:bg-tint',
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
            <div className="mt-1.5 ml-3 flex flex-col gap-1">
              {conversations.length === 0 ? (
                <p className="px-2 py-1 text-caption text-muted-foreground/70">No conversations</p>
              ) : (
                conversations.map((conversation) => (
                  <ConversationRow key={conversation.id} conversation={conversation} />
                ))
              )}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  )
}
