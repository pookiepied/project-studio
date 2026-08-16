import { useState } from 'react'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { Branch, Check, Disclosure } from '@/components/icons'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { useProjects } from '@/features/projects/ProjectsProvider'
import { cn } from '@/lib/utils'

/**
 * The checked-out branch, as a control rather than a caption.
 *
 * The old toolbar printed the branch name as static text beside the project
 * name — information you could read but not act on, which is the least useful
 * form a piece of state can take in a title bar. Xcode, Tower and GitHub
 * Desktop all put the branch in the same spot and all make it a menu, because
 * "which branch am I on" and "switch branch" are the same thought a second
 * apart.
 *
 * It renders nothing for a project without a worktree. A disabled or empty
 * branch control on a folder of PDFs is noise.
 */
export function BranchSwitcher() {
  const { view } = useNavigation()
  const { getProject, setBranch } = useProjects()
  const [open, setOpen] = useState(false)

  const project = view.name === 'project' ? getProject(view.projectId) : undefined
  if (!project?.branch) return null

  const branches = project.branches ?? [project.branch]

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={cn(
          'flex h-7 max-w-[180px] shrink-0 items-center gap-1.5 rounded-md px-2 transition-colors duration-150',
          'outline-none focus-visible:ring-2 focus-visible:ring-ring',
          open ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
        aria-label={`Branch: ${project.branch}. Switch branch`}
      >
        <Branch size="xs" className="shrink-0" />
        <span className="truncate font-mono text-[11px]">{project.branch}</span>
        <Disclosure size="xs" className="shrink-0 rotate-90 opacity-60" aria-hidden />
      </PopoverTrigger>

      <PopoverContent side="bottom" align="end" className="w-64">
        <p className="px-2 pt-0.5 pb-1.5 text-[11px] font-medium tracking-wider text-muted-foreground/70 uppercase">
          Branches
        </p>
        <div role="listbox" aria-label="Branches" className="flex flex-col gap-px">
          {branches.map((branch) => {
            const selected = branch === project.branch
            return (
              <button
                key={branch}
                type="button"
                role="option"
                aria-selected={selected}
                onClick={() => {
                  setBranch(project.id, branch)
                  setOpen(false)
                }}
                className={cn(
                  'flex items-center gap-2 rounded-sm px-2 py-1.5 text-left transition-colors duration-150',
                  selected ? 'bg-muted' : 'hover:bg-muted/60',
                )}
              >
                <Branch size="xs" className="shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate font-mono text-[11px]">{branch}</span>
                {selected && <Check size="xs" className="shrink-0 text-foreground" />}
              </button>
            )
          })}
        </div>
        <p className="px-2 pt-2 text-[11px] leading-snug text-muted-foreground">
          Demo state — switching moves the label. Real checkout arrives with the
          harness.
        </p>
      </PopoverContent>
    </Popover>
  )
}
