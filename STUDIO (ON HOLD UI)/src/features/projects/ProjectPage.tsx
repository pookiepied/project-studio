import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { VIEW_TRANSITION } from '@/app/motion'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import type { ProjectTab } from '@/app/navigation/views'
import { Chat, Folder, Note, Plus, Tasks } from '@/components/icons'
import { SegmentedControl, type SegmentedControlOption } from '@/components/ui/segmented-control'
import ChatPage from '@/features/chat/ChatPage'
import { FilesPanel } from '@/features/projects/panels/FilesPanel'
import { NotesPanel } from '@/features/projects/panels/NotesPanel'
import { TasksPanel } from '@/features/projects/panels/TasksPanel'
import { useProjects } from '@/features/projects/ProjectsProvider'

const TAB_OPTIONS: ReadonlyArray<SegmentedControlOption<ProjectTab>> = [
  { value: 'chat', label: 'Chat', icon: Chat },
  { value: 'notes', label: 'Notes', icon: Note },
  { value: 'tasks', label: 'Tasks', icon: Tasks },
  { value: 'files', label: 'Files', icon: Folder },
]

/**
 * A project workspace: a tab strip over one of four surfaces.
 *
 * The identity of the project — its name, its conversation, its branch — is
 * *not* here any more. It moved to the title bar, where it sits at the same
 * place for every view in the app. What is left in this header is the one
 * thing that is genuinely local to a project: which of its surfaces you are
 * looking at.
 *
 * That split is also what fixed the second collision. The old toolbar put an
 * icon-only tab group flush against the right edge of the surface, exactly
 * where the fixed context-panel toggle was floating.
 *
 * Tabs are labelled now, not icon-only. Four glyphs with no text asks the user
 * to learn a private vocabulary for a decision they make constantly; the
 * labels cost about 90px and remove the guesswork.
 */
export default function ProjectPage({ projectId }: { projectId: string }) {
  const { view, setProjectTab, setActiveChat } = useNavigation()
  const { getProject, createChat } = useProjects()
  const project = getProject(projectId)
  const projectChatId = view.name === 'project' ? view.chatId : null
  const firstChatId = project?.chats[0]?.id ?? null

  useEffect(() => {
    if (projectChatId === null && firstChatId) setActiveChat(firstChatId)
  }, [projectChatId, firstChatId, setActiveChat])

  if (!project || view.name !== 'project') return null

  const chatId = view.chatId ?? firstChatId

  const newChat = () => {
    const chat = createChat(project.id)
    setActiveChat(chat.id)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b border-border px-6">
        <SegmentedControl
          options={TAB_OPTIONS}
          value={view.tab}
          onChange={setProjectTab}
          ariaLabel="Project surface"
        />
      </header>

      <div className="min-h-0 flex-1">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={view.tab} {...VIEW_TRANSITION} className="h-full min-h-0">
            {view.tab === 'chat' &&
              (chatId ? (
                <ChatPage key={chatId} />
              ) : (
                <EmptyProject onNewChat={newChat} />
              ))}
            {view.tab === 'notes' && <NotesPanel project={project} />}
            {view.tab === 'tasks' && <TasksPanel project={project} />}
            {view.tab === 'files' && <FilesPanel project={project} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  )
}

function EmptyProject({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3">
      <p className="text-[13px] text-muted-foreground">No conversation yet.</p>
      <button
        type="button"
        onClick={onNewChat}
        className="flex h-8 items-center gap-1.5 rounded-md border border-border bg-surface-raised px-3 text-[13px] font-medium transition-colors duration-150 outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Plus size="sm" />
        New conversation
      </button>
    </div>
  )
}
