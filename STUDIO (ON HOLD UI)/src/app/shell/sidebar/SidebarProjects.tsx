import { useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION } from '@/app/motion'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { useChrome } from '@/app/shell/ChromeProvider'
import { Chat, Disclosure, Plus } from '@/components/icons'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { PROJECT_ICONS } from '@/features/projects/projectIcons'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { Project } from '@/features/projects/types'
import { cn } from '@/lib/utils'

/** Row height. Every row in the tree is this tall, at every depth. */
const ROW = 'h-7'

/**
 * The project tree — the navigator's reason to exist.
 *
 * Projects are the unit of work; each expands in place to show the
 * conversations inside it. Expansion is tracked as a *collapsed* set so every
 * project starts open, the way a Notion sidebar does.
 *
 * The search field that used to sit above this is gone. Filtering a tree in
 * place and searching the whole app are different jobs, and having a box that
 * only did the first one — while ⌘K did not exist — meant the obvious gesture
 * found nothing. Search is now one thing, in the title bar, and it reaches
 * projects, conversations and commands alike.
 */
export function SidebarProjects() {
  const { projects } = useProjects()
  const { setNewProjectOpen } = useChrome()
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set())

  const toggleCollapsed = (id: string) => {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col pt-3">
      <div className="flex h-6 shrink-0 items-center justify-between pr-2 pl-4">
        <span className="text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
          Projects
        </span>
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label="New project"
                onClick={() => setNewProjectOpen(true)}
                className="flex size-6 items-center justify-center rounded-sm text-muted-foreground transition-colors duration-150 outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus size="sm" />
              </button>
            }
          />
          <TooltipContent side="right">New project</TooltipContent>
        </Tooltip>
      </div>

      <div className="mt-1 min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {projects.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            collapsed={collapsedIds.has(project.id)}
            onToggleCollapsed={() => toggleCollapsed(project.id)}
          />
        ))}
      </div>
    </div>
  )
}

function ProjectRow({
  project,
  collapsed,
  onToggleCollapsed,
}: {
  project: Project
  collapsed: boolean
  onToggleCollapsed: () => void
}) {
  const { view, openProject, openChat } = useNavigation()
  const { createChat } = useProjects()

  const IconGlyph = PROJECT_ICONS[project.icon]
  const isActiveProject = view.name === 'project' && view.projectId === project.id

  const newChat = () => {
    const chat = createChat(project.id)
    openChat(project.id, chat.id)
  }

  return (
    <div>
      <div
        className={cn(
          'group flex items-center rounded-md transition-colors duration-150',
          ROW,
          isActiveProject ? 'bg-muted' : 'hover:bg-muted/60',
        )}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${project.name}`}
          className="flex size-6 shrink-0 items-center justify-center rounded-xs text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Disclosure
            size="xs"
            className={cn(
              'transition-transform duration-150 ease-[cubic-bezier(0.16,1,0.3,1)]',
              !collapsed && 'rotate-90',
            )}
          />
        </button>

        <button
          type="button"
          onClick={() => openProject(project.id)}
          aria-current={isActiveProject ? 'page' : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-2 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <IconGlyph
            size="sm"
            className={cn(
              'shrink-0 transition-colors duration-150',
              isActiveProject ? 'text-foreground' : 'text-muted-foreground',
            )}
          />
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[13px] transition-colors duration-150',
              isActiveProject ? 'font-medium text-foreground' : 'text-foreground/85',
            )}
          >
            {project.name}
          </span>
        </button>

        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                aria-label={`New chat in ${project.name}`}
                onClick={newChat}
                className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-xs text-muted-foreground opacity-0 transition-opacity duration-150 outline-none group-hover:opacity-100 hover:text-foreground focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Plus size="xs" />
              </button>
            }
          />
          <TooltipContent side="right">New chat</TooltipContent>
        </Tooltip>
      </div>

      {/*
        Rendered conditionally, and not animated.

        Three animated approaches were tried and measured, and all three failed
        on this stack: `AnimatePresence` never completes a conditional removal;
        framer's `height: 'auto'` left the element at its expanded style; and a
        `grid-template-rows` transition never resolves in a container with
        indefinite block size (it collapses correctly only with the transition
        removed). A measured-pixel `height` transition worked but oscillated
        against its own `ResizeObserver`.

        A disclosure that snaps is normal — Finder's list view snaps. A
        disclosure that leaves invisible, focusable rows in the tree is a bug.
        Given the choice, this takes the snap. Motion here is the caret, which
        rotates and carries the state change on its own.
      */}
      {!collapsed && (
        <div className="relative pb-0.5">
          {/*
            The guide rail. A tree with no rail relies on indentation alone,
            and at 13px with truncated labels that reads as a list of unrelated
            rows. One hairline at the disclosure's centre line ties the
            children to their parent — the same device Finder's list view and
            VS Code's explorer both use.
          */}
          <span aria-hidden className="absolute inset-y-0 left-3 w-px bg-border" />
          {project.chats.map((chat) => (
            <ChatRow
              key={chat.id}
              chat={chat}
              active={isActiveProject && view.name === 'project' && view.chatId === chat.id}
              onOpen={() => openChat(project.id, chat.id)}
            />
          ))}
          {project.chats.length === 0 && (
            <p className="py-1 pr-2 pl-7 text-[11px] text-muted-foreground/70">
              No conversations yet.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

function ChatRow({
  chat,
  active,
  onOpen,
}: {
  chat: { id: string; title: string }
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex w-full items-center gap-2 rounded-md pr-2 pl-7 text-left outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring',
        ROW,
        active ? 'bg-muted' : 'hover:bg-muted/60',
      )}
    >
      {/* The active row's own segment of rail, in foreground, so the selection
          reads down the tree as well as across the row. */}
      {active && (
        <motion.span
          layoutId="sidebar-active-rail"
          transition={{ duration: DURATION.fast }}
          aria-hidden
          className="absolute inset-y-0.5 left-3 w-px bg-foreground"
        />
      )}
      <Chat
        size="xs"
        className={cn('shrink-0', active ? 'text-foreground' : 'text-muted-foreground')}
      />
      <span
        className={cn(
          'min-w-0 flex-1 truncate text-xs',
          active ? 'font-medium text-foreground' : 'text-muted-foreground',
        )}
      >
        {chat.title}
      </span>
    </button>
  )
}
