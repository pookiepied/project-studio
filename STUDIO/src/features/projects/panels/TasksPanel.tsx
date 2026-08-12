import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Plus } from '@/components/icons'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { Project } from '@/features/projects/types'
import { cn } from '@/lib/utils'

/**
 * The project's to-do list. One add field on top, rows beneath, a count at
 * the bottom — the whole thing fits in a single column because a task list
 * that needs explaining has already failed.
 */
export function TasksPanel({ project }: { project: Project }) {
  const { addTask, toggleTask } = useProjects()
  const [draft, setDraft] = useState('')

  const doneCount = project.tasks.filter((task) => task.done).length

  const add = () => {
    const title = draft.trim()
    if (!title) return
    addTask(project.id, title)
    setDraft('')
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-xl px-6 py-7">
        <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 transition-colors focus-within:border-ring/60">
          <Plus size="sm" className="shrink-0 text-muted-foreground" />
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') add()
            }}
            placeholder="Add a task…"
            aria-label="Add a task"
            className="h-6 w-full bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div className="mt-3 flex flex-col">
          <AnimatePresence initial={false}>
            {project.tasks.map((task) => (
              <motion.div
                key={task.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 420, damping: 34 }}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
              >
                <button
                  type="button"
                  onClick={() => toggleTask(project.id, task.id)}
                  aria-pressed={task.done}
                  aria-label={task.done ? `Mark "${task.title}" not done` : `Mark "${task.title}" done`}
                  className={cn(
                    'flex size-[18px] shrink-0 items-center justify-center rounded-md border transition-colors',
                    task.done
                      ? 'border-foreground bg-foreground text-background'
                      : 'border-border hover:border-muted-foreground',
                  )}
                >
                  {task.done && <Check size="xs" />}
                </button>
                <span
                  className={cn(
                    'min-w-0 flex-1 text-[13px] transition-colors',
                    task.done && 'text-muted-foreground line-through',
                  )}
                >
                  {task.title}
                </span>
              </motion.div>
            ))}
          </AnimatePresence>

          {project.tasks.length === 0 && (
            <p className="px-2 py-3 text-xs text-muted-foreground">
              Nothing here yet. Add the first task above.
            </p>
          )}
        </div>

        {project.tasks.length > 0 && (
          <p className="mt-3 px-2 text-[11px] text-muted-foreground tabular-nums">
            {doneCount} of {project.tasks.length} done
          </p>
        )}
      </div>
    </div>
  )
}
