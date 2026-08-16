import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, Dialog, IconButton, TextArea, TextField } from '@/components/primitives'
import { ProjectIconMark } from '@/domain/projects/ProjectIconMark'
import { DEFAULT_PROJECT_ICON, PROJECT_ICONS, type ProjectIcon } from '@/domain/projects/types'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * Creating a project: a name, a mark, and the folders it works in.
 *
 * Folders are the substance here, so they are not an afterthought at the
 * bottom. A project with no folder is a label; a project with folders is
 * something the agent can actually work in, and the form says so by refusing to
 * submit without at least one.
 *
 * The picker is demo-only in this build -- it appends a plausible path rather
 * than opening the OS dialog, because the real one is a Tauri capability that
 * belongs with the harness work. The shape of what it produces is real, so
 * swapping it is one function.
 */
export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createProject } = useWorkspace()
  const { openProject } = useNavigation()

  const [name, setName] = useState('')
  const [icon, setIcon] = useState<ProjectIcon>(DEFAULT_PROJECT_ICON)
  const [description, setDescription] = useState('')
  const [folders, setFolders] = useState<{ name: string; path: string }[]>([])

  const valid = name.trim().length > 0 && folders.length > 0

  const reset = () => {
    setName('')
    setIcon(DEFAULT_PROJECT_ICON)
    setDescription('')
    setFolders([])
  }

  const close = () => {
    reset()
    onClose()
  }

  const addFolder = () => {
    const index = folders.length + 1
    const slug = name.trim().toLowerCase().replace(/\s+/g, '-') || 'project'
    setFolders((current) => [
      ...current,
      { name: index === 1 ? slug : `${slug}-${index}`, path: `D:/Work/${slug}${index === 1 ? '' : `-${index}`}` },
    ])
  }

  const submit = () => {
    if (!valid) return
    const project = createProject({ name, icon, description, folders })
    reset()
    onClose()
    openProject(project.id)
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New project"
      width="28rem"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} onClick={submit}>
            Create project
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4 pt-1">
        <Field label="Name">
          <TextField value={name} onChange={setName} placeholder="Quiet Hours" autoFocus />
        </Field>

        <Field label="Mark">
          <div className="flex flex-wrap gap-1">
            {PROJECT_ICONS.map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-label={candidate}
                aria-pressed={icon === candidate}
                onClick={() => setIcon(candidate)}
                className={cn(
                  'flex size-8 items-center justify-center rounded-md border transition-colors duration-fast',
                  icon === candidate
                    ? 'border-foreground/25 bg-selected text-foreground'
                    : 'border-transparent text-muted-foreground hover:bg-tint hover:text-foreground',
                )}
              >
                <ProjectIconMark icon={candidate} />
              </button>
            ))}
          </div>
        </Field>

        <Field label="Description" optional>
          <TextArea
            value={description}
            onChange={setDescription}
            rows={2}
            placeholder="What this project is for."
          />
        </Field>

        <Field label="Source folders">
          <div className="flex flex-col gap-1">
            {folders.map((folder, index) => (
              <div
                key={folder.path}
                className="flex items-center gap-2 rounded-md border bg-surface px-2 py-1.5"
              >
                <Icons.project className="text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate text-ui text-foreground">{folder.name}</span>
                <span className="hidden shrink-0 text-micro text-muted-foreground sm:block">
                  {folder.path}
                </span>
                <IconButton
                  label={`Remove ${folder.name}`}
                  size="sm"
                  onClick={() => setFolders((current) => current.filter((_, i) => i !== index))}
                >
                  <Icons.close />
                </IconButton>
              </div>
            ))}

            <button
              type="button"
              onClick={addFolder}
              className="flex items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
            >
              <Icons.add />
              Add folder
            </button>

            {folders.length === 0 ? (
              <p className="text-micro text-muted-foreground/80">
                A project needs at least one folder to work in.
              </p>
            ) : null}
          </div>
        </Field>
      </div>
    </Dialog>
  )
}

function Field({
  label,
  optional = false,
  children,
}: {
  label: string
  optional?: boolean
  children: React.ReactNode
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-caption text-muted-foreground">
        {label}
        {optional ? <span className="text-muted-foreground/60"> &middot; optional</span> : null}
      </span>
      {children}
    </label>
  )
}
