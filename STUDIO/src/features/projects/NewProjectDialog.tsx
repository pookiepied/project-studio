import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT, SPRING_SURFACE } from '@/app/motion'
import { useMountTransition } from '@/app/useMountTransition'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { useChrome } from '@/app/shell/ChromeProvider'
import { Close, Folder } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { PROJECT_ICON_IDS, PROJECT_ICONS } from '@/features/projects/projectIcons'
import { useProjects } from '@/features/projects/ProjectsProvider'
import type { ProjectIconId } from '@/features/projects/types'
import { cn } from '@/lib/utils'

/**
 * The New Project sheet — the Codex-style flow: name it, pick its mark, point
 * it at as many source folders as you like, create. One calm sheet, no steps.
 *
 * Demo-only: folder rows are typed paths, not a filesystem browse. The real
 * picker arrives with the Tauri dialog plugin alongside the harness.
 */
export function NewProjectDialog() {
  const { newProjectOpen, setNewProjectOpen } = useChrome()
  const { createProject } = useProjects()
  const { openChat } = useNavigation()

  const [name, setName] = useState('')
  const [icon, setIcon] = useState<ProjectIconId>('folder')
  const [folders, setFolders] = useState<string[]>([])
  const [folderDraft, setFolderDraft] = useState('')

  const close = () => setNewProjectOpen(false)

  // Back to a blank sheet every time it opens.
  useEffect(() => {
    if (!newProjectOpen) return
    setName('')
    setIcon('folder')
    setFolders([])
    setFolderDraft('')
  }, [newProjectOpen])

  // Escape is the sheet's cancel.
  useEffect(() => {
    if (!newProjectOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setNewProjectOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [newProjectOpen, setNewProjectOpen])

  const addFolder = () => {
    const folder = folderDraft.trim()
    if (!folder || folders.includes(folder)) return
    setFolders((current) => [...current, folder])
    setFolderDraft('')
  }

  const create = () => {
    const trimmed = name.trim()
    if (!trimmed) return
    const project = createProject({ name: trimmed, icon, folders })
    close()
    openChat(project.id, project.chats[0].id)
  }

  const mounted = useMountTransition(newProjectOpen, DURATION.base * 1000)
  if (!mounted) return null

  return (
    /*
      Lifecycle is `useMountTransition`, not `AnimatePresence` — conditional
      presence never completes on this framer-motion/React pairing and leaves
      an invisible `fixed inset-0` sheet behind that eats every click in the
      app. See `app/useMountTransition.ts`.
    */
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: newProjectOpen ? 1 : 0 }}
      transition={{ duration: DURATION.base, ease: EASE_OUT }}
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
    >
          <div
            onClick={close}
            /* Blurred, not just dimmed. A flat black wash tells you something
               is modal; a blur tells you the app is still there behind it,
               which is the difference between a dialog and a page change. */
            className="studio-blur-scrim absolute inset-0 bg-scrim"
            aria-hidden
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="New project"
            initial={{ opacity: 0, y: 10, scale: 0.97 }}
            animate={
              newProjectOpen ? { opacity: 1, y: 0, scale: 1 } : { opacity: 0, y: 8, scale: 0.98 }
            }
            transition={
              newProjectOpen ? SPRING_SURFACE : { duration: DURATION.base, ease: EASE_OUT }
            }
            className="studio-blur relative w-full max-w-md rounded-xl border border-border p-5 shadow-2xl"
          >
            <h2 className="font-display text-[24px] leading-none tracking-tight">New project</h2>
            <p className="mt-2 text-xs text-muted-foreground">
              Folders, chats, notes and files — gathered around one piece of work.
            </p>

            <div className="mt-5">
              <label htmlFor="project-name" className="text-xs font-medium">
                Name
              </label>
              <input
                id="project-name"
                autoFocus
                value={name}
                onChange={(event) => setName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') create()
                }}
                placeholder="Aurora Film Score"
                className="mt-1.5 h-8 w-full rounded-md border border-border bg-surface px-2.5 text-[13px] outline-none transition-colors duration-150 placeholder:text-muted-foreground/60 focus:border-foreground/25"
              />
            </div>

            <div className="mt-4">
              <span className="text-xs font-medium">Icon</span>
              <div className="mt-1.5 flex flex-wrap gap-1">
                {PROJECT_ICON_IDS.map((id) => {
                  const IconGlyph = PROJECT_ICONS[id]
                  const selected = id === icon
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setIcon(id)}
                      aria-label={`${id} icon`}
                      aria-pressed={selected}
                      className={cn(
                        'flex size-8 items-center justify-center rounded-md transition-colors duration-150',
                        selected
                          ? 'bg-muted text-foreground ring-1 ring-border'
                          : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                      )}
                    >
                      <IconGlyph size="md" />
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="mt-4">
              <label htmlFor="project-folder" className="text-xs font-medium">
                Source folders
                <span className="ml-1.5 font-normal text-muted-foreground">optional</span>
              </label>

              {folders.length > 0 && (
                <ul className="mt-1.5 flex flex-col gap-0.5">
                  {folders.map((folder) => (
                    <li
                      key={folder}
                      className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted/60"
                    >
                      <Folder size="sm" className="shrink-0 text-muted-foreground" />
                      <span className="min-w-0 flex-1 truncate text-[13px]">{folder}</span>
                      <button
                        type="button"
                        onClick={() =>
                          setFolders((current) => current.filter((entry) => entry !== folder))
                        }
                        aria-label={`Remove ${folder}`}
                        className="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        <Close size="xs" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-1.5 flex items-center gap-1.5">
                <input
                  id="project-folder"
                  value={folderDraft}
                  onChange={(event) => setFolderDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      addFolder()
                    }
                  }}
                  placeholder="~/projects/my-folder"
                  className="h-8 min-w-0 flex-1 rounded-md border border-border bg-surface px-2.5 text-[13px] outline-none transition-colors duration-150 placeholder:text-muted-foreground/60 focus:border-foreground/25"
                />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={addFolder}
                  disabled={!folderDraft.trim()}
                >
                  Add
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Folders Studio can read while it works. Add as many as you like.
              </p>
            </div>

            <div className="mt-6 flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={close}>
                Cancel
              </Button>
              <Button size="sm" onClick={create} disabled={!name.trim()}>
                Create project
              </Button>
            </div>
          </motion.div>
    </motion.div>
  )
}
