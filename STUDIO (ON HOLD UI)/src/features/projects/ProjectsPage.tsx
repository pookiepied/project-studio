import { motion } from 'framer-motion'
import { EASE_OUT, DURATION, SPRING_SNAPPY, staggerDelay } from '@/app/motion'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { useChrome } from '@/app/shell/ChromeProvider'
import { Chat, Folder, Plus } from '@/components/icons'
import { PROJECT_ICONS } from '@/features/projects/projectIcons'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { Project } from '@/features/projects/types'
import { cn } from '@/lib/utils'

/** How many conversations a card previews before it stops. */
const PREVIEW_CHATS = 3

/**
 * The home surface: every project as a card.
 *
 * The old cards were a bordered rectangle with a glyph, a name and a count —
 * true, and useless. Nothing on them answered the question you actually open
 * this page with, which is *where was I*. A card that lists its recent
 * conversations answers it, and the rows are live: clicking one skips the
 * project entirely and lands in the thread. That is the difference between a
 * grid of labels and a grid of entry points.
 *
 * Cards are still monochrome and still quiet. The depth comes from the surface
 * ordering in `index.css` — a raised plane on a hairline — plus a 1px lift on
 * hover. No colour, no gradient, no coloured shadow.
 */
export default function ProjectsPage() {
  const { projects } = useProjects()
  const { setNewProjectOpen } = useChrome()

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-5xl px-6 pt-10 pb-12">
        <header className="flex items-end justify-between gap-4">
          <div className="min-w-0">
            <h1 className="studio-display text-[32px] leading-none">Projects</h1>
            <p className="mt-2 text-[13px] text-muted-foreground">
              Every piece of work, gathered in one place.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setNewProjectOpen(true)}
            className="flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-medium text-primary-foreground transition-colors duration-150 outline-none hover:bg-primary/85 focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Plus size="sm" />
            New project
          </button>
        </header>

        <div className="mt-8 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {projects.map((project, index) => (
            <ProjectCard key={project.id} project={project} index={index} />
          ))}
          <NewProjectCard index={projects.length} onClick={() => setNewProjectOpen(true)} />
        </div>
      </div>
    </div>
  )
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function ProjectCard({ project, index }: { project: Project; index: number }) {
  const { openProject, openChat } = useNavigation()
  const IconGlyph = PROJECT_ICONS[project.icon]
  const preview = project.chats.slice(0, PREVIEW_CHATS)
  const overflow = project.chats.length - preview.length

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_SNAPPY, delay: staggerDelay(index) }}
      /*
        A group, not a button. The card contains conversation rows that are
        themselves controls, and a button inside a button is invalid HTML that
        browsers resolve by dropping one of them — usually the one you wanted.
        The header is the control that opens the project; the card is scenery.
      */
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border border-border bg-surface-raised',
        'transition-[border-color,box-shadow,transform] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]',
        'hover:-translate-y-px hover:border-foreground/15 hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.10)]',
        'dark:hover:shadow-[0_4px_16px_-4px_rgba(0,0,0,0.5)]',
      )}
    >
      <button
        type="button"
        onClick={() => openProject(project.id)}
        /* 14 (card) − 4 (inset) = 10 → the `lg` step. The concentric rule. */
        className="m-1 flex items-start gap-3 rounded-lg p-3 text-left outline-none transition-colors duration-150 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground transition-colors duration-150 group-hover:bg-accent">
          <IconGlyph size="md" />
        </span>
        <span className="min-w-0 flex-1 pt-0.5">
          <span className="block truncate text-[13px] font-medium text-foreground">
            {project.name}
          </span>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Folder size="xs" className="shrink-0" />
            <span className="truncate">
              {plural(project.folders.length, 'folder')} ·{' '}
              {plural(project.chats.length, 'conversation')}
            </span>
          </span>
        </span>
      </button>

      {preview.length > 0 && (
        <div className="mt-auto border-t border-border/70 p-1">
          {preview.map((chat) => (
            <button
              key={chat.id}
              type="button"
              onClick={() => openChat(project.id, chat.id)}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left outline-none transition-colors duration-150 hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
            >
              <Chat size="xs" className="shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground transition-colors duration-150 hover:text-foreground">
                {chat.title}
              </span>
            </button>
          ))}
          {overflow > 0 && (
            <p className="px-2 py-1 text-[11px] text-muted-foreground/70">
              +{overflow} more
            </p>
          )}
        </div>
      )}
    </motion.div>
  )
}

function NewProjectCard({ index, onClick }: { index: number; onClick: () => void }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...SPRING_SNAPPY, delay: staggerDelay(index) }}
      onClick={onClick}
      className={cn(
        'flex min-h-[124px] flex-col items-start rounded-xl border border-dashed border-border p-4 text-left',
        'transition-colors duration-150 outline-none',
        'hover:border-foreground/20 hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring',
      )}
    >
      <motion.span
        whileHover={{ rotate: 90 }}
        transition={{ duration: DURATION.base, ease: EASE_OUT }}
        className="flex size-9 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground"
      >
        <Plus size="md" />
      </motion.span>
      <span className="mt-3 text-[13px] font-medium text-muted-foreground">New project</span>
      <span className="mt-1 text-[11px] text-muted-foreground/70">
        Folders, chats, notes &amp; files
      </span>
    </motion.button>
  )
}
