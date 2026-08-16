import { useState } from 'react'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { Check, Chat, Disclosure, Plus } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { PROJECT_ICONS } from '@/features/projects/projectIcons'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { Project } from '@/features/projects/types'
import { cn } from '@/lib/utils'

/**
 * Where you are, as one line in the title bar.
 *
 * This is the piece that gives the app a fixed place for a title. Before, the
 * home grid rendered a 34px display heading at `pt-12 px-8`, the project view
 * rendered a 13px heading at `h-[52px] px-5`, and the chat had none at all —
 * so moving between them slid the title diagonally across the window. Every
 * surface now reports its location here, at one x and one y, and the content
 * below is free to start wherever it reads best.
 *
 * The hierarchy is project-first, deliberately. A conversation is a thing
 * *inside* a project; leading with the conversation title (as the old toolbar
 * did) inverts the model the sidebar teaches. So: project, then conversation,
 * with the project as the stronger of the two.
 *
 * Both segments are controls. The project opens the project; the conversation
 * opens a switcher, because "which of these threads am I in" is a question the
 * sidebar can answer but only if it is open.
 */
export function LocationTitle() {
  const { view } = useNavigation()
  const { getProject } = useProjects()

  if (view.name === 'projects') return <StaticLocation label="Projects" />
  if (view.name === 'settings') return <StaticLocation label="Settings" />

  const project = getProject(view.projectId)
  if (!project) return null

  return <ProjectLocation project={project} chatId={view.chatId} />
}

/** A location with nothing to drill into — the home grid, settings. */
function StaticLocation({ label }: { label: string }) {
  return (
    <span className="truncate text-[13px] font-medium text-foreground" data-tauri-drag-region>
      {label}
    </span>
  )
}

function ProjectLocation({ project, chatId }: { project: Project; chatId: string | null }) {
  const { openProject, view } = useNavigation()
  const IconGlyph = PROJECT_ICONS[project.icon]
  const conversation = project.chats.find((chat) => chat.id === chatId)

  // Only the chat tab has a conversation. On notes/tasks/files the second
  // segment names the surface instead — showing a conversation title while
  // looking at the files list would be a lie about where you are.
  const inChat = view.name === 'project' && view.tab === 'chat'

  return (
    <div className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => openProject(project.id)}
        className={cn(
          'flex min-w-0 shrink items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors duration-150',
          'outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
        )}
      >
        <IconGlyph size="sm" className="shrink-0 text-muted-foreground" />
        <span className="truncate text-[13px] font-medium text-foreground">{project.name}</span>
      </button>

      <Disclosure size="xs" className="shrink-0 text-muted-foreground/50" aria-hidden />

      {inChat ? (
        <ConversationSwitcher project={project} conversation={conversation} />
      ) : (
        <span className="truncate px-1.5 text-[13px] text-muted-foreground capitalize">
          {view.name === 'project' ? view.tab : ''}
        </span>
      )}
    </div>
  )
}

function ConversationSwitcher({
  project,
  conversation,
}: {
  project: Project
  conversation: { id: string; title: string } | undefined
}) {
  const { setActiveChat } = useNavigation()
  const { createChat } = useProjects()
  const [open, setOpen] = useState(false)

  const pick = (chatId: string) => {
    setActiveChat(chatId)
    setOpen(false)
  }

  const startNew = () => {
    const chat = createChat(project.id)
    pick(chat.id)
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'flex min-w-0 shrink items-center gap-1 rounded-md px-1.5 py-1 transition-colors duration-150',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted',
        )}
        aria-label={`Conversation: ${conversation?.title ?? 'none'}. Switch conversation`}
      >
        <span className="truncate text-[13px]">{conversation?.title ?? 'New conversation'}</span>
        <Disclosure size="xs" className="shrink-0 rotate-90 opacity-60" aria-hidden />
      </PopoverTrigger>

      {/* Popover radius is 10 with 6 padding, so rows are 10 − 6 = 4… rounded
          to the `sm` step at 6, which is the nearest scale value that still
          nests. See the concentric rule in `index.css`. */}
      <PopoverContent side="bottom" align="start" className="w-64">
        <div role="listbox" aria-label="Conversations" className="flex flex-col gap-px">
          {project.chats.map((chat) => {
            const selected = chat.id === conversation?.id
            return (
              <button
                key={chat.id}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => pick(chat.id)}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-150',
                  selected ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <Chat size="xs" className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-xs">{chat.title}</span>
                {selected && <Check size="xs" className="shrink-0 text-foreground" />}
              </button>
            )
          })}
        </div>

        <div className="my-1 h-px bg-border" />

        <button
          type="button"
          onClick={startNew}
          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-150 hover:bg-muted/60"
        >
          <Plus size="xs" className="shrink-0 text-muted-foreground" />
          <span className="text-xs">New conversation</span>
        </button>
      </PopoverContent>
    </Popover>
  )
}
