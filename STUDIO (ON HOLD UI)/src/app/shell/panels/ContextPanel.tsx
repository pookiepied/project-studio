import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_PANEL } from '@/app/motion'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { useChrome } from '@/app/shell/ChromeProvider'
import { SHELL } from '@/app/shell/shellConfig'
import { Folder, Note } from '@/components/icons'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { Project } from '@/features/projects/types'

/**
 * The right region: context for whatever is open.
 *
 * Same construction as the navigator — a rounded panel on the tray, resizable,
 * springing in and out. Today it reads the active project;
 * when the harness lands this is where live context goes (files touched, tools
 * run, tokens spent).
 */
export function ContextPanel() {
  const { contextOpen, contextWidth } = useChrome()
  const { view } = useNavigation()
  const { getProject } = useProjects()
  const project = view.name === 'project' ? getProject(view.projectId) : undefined

  return (
    <motion.div
      initial={false}
      /* Closed, the rail takes no space at all — not even the tray gutter. */
      animate={{ width: contextOpen ? contextWidth : 0, marginLeft: contextOpen ? 0 : -SHELL.panelGap }}
      transition={SPRING_PANEL}
      className="relative min-h-0 shrink-0 overflow-hidden"
      aria-hidden={!contextOpen}
    >
      <motion.aside
        aria-label="Context"
        initial={false}
        animate={{ x: contextOpen ? 0 : 16, opacity: contextOpen ? 1 : 0 }}
        transition={SPRING_PANEL}
        className="flex h-full flex-col overflow-hidden border border-border bg-surface"
        style={{
          width: contextWidth,
          minWidth: SHELL.contextPanel.minWidth,
          borderRadius: SHELL.panelRadius,
        }}
      >
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {project ? (
            <ProjectDetails project={project} />
          ) : (
            <p className="text-xs leading-relaxed text-muted-foreground">
              Open a project and its folders, progress and notes will live here.
            </p>
          )}
        </div>
      </motion.aside>
    </motion.div>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 first:mt-0">
      <h3 className="pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
        {label}
      </h3>
      {children}
    </section>
  )
}

function ProjectDetails({ project }: { project: Project }) {
  const { setProjectTab } = useNavigation()
  const tasksDone = project.tasks.filter((task) => task.done).length

  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div
        key={project.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: DURATION.fast, ease: EASE_OUT }}
      >
        {/* Context window first. It is the only thing here that changes while
            you work, and the only thing that can stop a turn from running —
            which makes it the answer to "why is it behaving like that". */}
        <Section label="Context window">
          <ContextMeter used={0.33} tokens="42.6k" />
        </Section>

        <Section label="Source folders">
          {project.folders.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {project.folders.map((folder) => (
                <li key={folder} className="flex items-center gap-2 text-xs text-foreground/90">
                  <Folder size="xs" className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{folder}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">No folders linked yet.</p>
          )}
        </Section>

        <Section label="In this project">
          <dl className="flex flex-col gap-1 text-xs">
            <Row term="Conversations" value={String(project.chats.length)} />
            <Row term="Notes" value={String(project.notes.length)} />
            <Row term="Tasks" value={`${tasksDone} of ${project.tasks.length} done`} />
            <Row term="Files & links" value={String(project.files.length)} />
          </dl>
        </Section>

        {project.notes.length > 0 && (
          <Section label="Recent notes">
            <ul className="flex flex-col gap-px">
              {project.notes.slice(0, 3).map((note) => (
                <li key={note.id}>
                  <button
                    type="button"
                    onClick={() => setProjectTab('notes')}
                    className="flex w-full items-center gap-2 rounded-sm px-1.5 py-1 text-left transition-colors duration-150 hover:bg-muted"
                  >
                    <Note size="xs" className="shrink-0 text-muted-foreground" />
                    <span className="truncate text-xs text-foreground/90">
                      {note.title || 'Untitled'}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * Context usage as a bar.
 *
 * Monochrome, so the bar cannot turn amber at 70% the way a coloured meter
 * would. It does not need to: the number is right there, and a fill that
 * approaches full is already the warning. Colour-coding a gauge is a habit
 * from dashboards, not a requirement of one.
 */
function ContextMeter({ used, tokens }: { used: number; tokens: string }) {
  const percent = Math.round(used * 100)

  return (
    <div className="rounded-lg border border-border bg-muted/30 p-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-xs font-medium tabular-nums">{tokens} tokens</span>
        <span className="text-[11px] text-muted-foreground tabular-nums">{percent}% used</span>
      </div>
      <div
        role="progressbar"
        aria-label="Context window usage"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
      >
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${percent}%` }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
          className="h-full rounded-full bg-foreground/70"
        />
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
        Conversation history and project context available to this chat.
      </p>
    </div>
  )
}

function Row({ term, value }: { term: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{term}</dt>
      <dd className="text-foreground/90 tabular-nums">{value}</dd>
    </div>
  )
}
