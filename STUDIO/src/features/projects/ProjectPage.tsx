import { SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { Loading, RetryButton, StateNote } from '@/components/state'
import { ProjectIconMark } from './ProjectIconMark'
import { ProjectExtensions } from '@/features/projects/ProjectExtensions'
import { StartConversation } from '@/features/chat/composer'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import type { Project } from '@/domain/projects/types'

/**
 * A project's own surface.
 *
 * The composer is here rather than a "new conversation" button, because
 * starting a conversation inside a project is the main thing anyone comes to a
 * project page to do, and a button that reveals a field is a step that exists
 * only to be clicked past. Sending creates the conversation already attached to
 * the project.
 *
 * Sending goes to the harness through `StartConversation`, the same component
 * home uses: this is the other entry point, and the only thing it decides
 * differently is that a conversation started here belongs to this project.
 *
 * The conversation list answers to the store's phase, not to its own length:
 * "Nothing here yet." while the index is still in flight would be a claim
 * about an answer nobody has received, so the list holds the rows' shape until
 * the read comes back, and says what went wrong if it fails.
 */
export function ProjectPage({ project }: { project: Project }) {
  const { conversations, storePhase, ensureStore } = useWorkspace()
  const { openChat } = useNavigation()

  const inProject = conversations
    .filter((conversation) => conversation.projectId === project.id && !conversation.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt)

  return (
    <div className="h-full overflow-y-auto studio-scroll-inset">
      <div
        className="mx-auto w-full"
        style={{
          maxWidth: SHELL.measure,
          paddingInline: SHELL.gutter,
          paddingTop: SHELL.topStrip.height + 28,
          paddingBottom: 32,
        }}
      >
        <header className="mb-6 flex items-start gap-3">
          <span className="mt-0.5 flex size-9 items-center justify-center rounded-lg bg-selected text-foreground">
            <ProjectIconMark icon={project.icon} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="studio-display truncate text-foreground">{project.name}</h1>
            {project.description ? (
              <p className="mt-0.5 text-ui text-muted-foreground">{project.description}</p>
            ) : null}
          </div>
        </header>

        <div className="mb-7">
          <StartConversation
            projectId={project.id}
            placeholder={`Ask about ${project.name}`}
          />
        </div>

        <Section title="Folders">
          <div className="flex flex-col gap-1">
            {project.folders.map((folder) => (
              <div
                key={folder.id}
                className="flex items-center gap-2 rounded-md border px-2.5 py-1.5"
              >
                <Icons.project />
                <span className="min-w-0 flex-1 truncate text-ui text-foreground">{folder.name}</span>
                {/* Capped, not shrinkable: truncate on a `shrink-0` item
                    never engages — the item is already exactly its content's
                    width — so a long path walked this row off the page at
                    phone width. The cap gives the path a share of the row to
                    ellipsize in and keeps the rest for the name. */}
                <span className="max-w-[40%] shrink-0 truncate text-micro text-muted-foreground">
                  {folder.path}
                </span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Conversations">
          {storePhase.status === 'loading' ? (
            <Loading label="Loading conversations" className="py-3" />
          ) : storePhase.status === 'failed' ? (
            <StateNote
              className="py-2"
              title="Could not read the conversations."
              detail={storePhase.error?.message ?? 'The harness stopped answering.'}
              action={<RetryButton onRetry={ensureStore} />}
            />
          ) : inProject.length === 0 ? (
            <p className="text-ui text-muted-foreground">Nothing here yet.</p>
          ) : (
            <div className="flex flex-col">
              {inProject.map((conversation) => (
                <button
                  key={conversation.id}
                  type="button"
                  onClick={() => openChat(conversation.id)}
                  className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-tint"
                >
                  {conversation.pinned ? (
                    <Icons.pin />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-ui text-foreground">
                    {conversation.title ?? 'Untitled'}
                  </span>
                  <span className="shrink-0 text-micro text-muted-foreground">
                    {relativeDay(conversation.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </Section>
        <Section title="Extensions">
          {/* The project's own decisions about what it can reach. Last on the
              page because the conversations above it are the work, and this is
              the configuration they answer to - the narrower scope lives
              where its project lives. */}
          <ProjectExtensions projectId={project.id} />
        </Section>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 text-micro text-muted-foreground/80 uppercase">{title}</h2>
      {children}
    </section>
  )
}

/** Coarse on purpose: an exact timestamp is precision nobody asked for here. */
function relativeDay(timestamp: number): string {
  const days = Math.floor((Date.now() - timestamp) / (24 * 60 * 60 * 1000))
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d`
  return `${Math.floor(days / 30)}mo`
}
