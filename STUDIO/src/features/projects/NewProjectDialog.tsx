import { useRef, useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, Dialog, IconButton, Segmented, TextArea, TextField } from '@/components/primitives'
import { StateNote } from '@/components/state/StateNote'
import { ProjectIconMark } from './ProjectIconMark'
import { DEFAULT_PROJECT_ICON, PROJECT_ICONS, type ProjectIcon } from '@/domain/projects/types'
import { isTauri, pickDirectory } from '@/platform/tauri'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { FolderBrowserDialog } from './FolderBrowserDialog'
import { cn } from '@/lib/cn'

/**
 * Creating a project: a name, a mark, and the folders it works in.
 *
 * Folders are the substance here, so they are not an afterthought at the
 * bottom. A project with no folder is a label; a project with folders is
 * something the agent can actually work in, and the form says so by refusing to
 * submit without at least one.
 *
 * A folder is a directory the person actually picked: on the desktop,
 * `Add folder` opens the OS directory dialog and names the row after the
 * directory's own last segment, because the point of a picker is that they
 * chose something. Cancelling appends nothing and raises nothing, and a
 * directory already picked is refused here, before the round trip. What makes
 * a path *valid* is the harness's alone - `validateFolderPath` refuses
 * volumes, system directories and absent paths on write - so this dialog does
 * not pre-judge any of that; it only carries the refusal's sentence back
 * verbatim when the store says no. Outside the desktop app there is no native
 * picker to open, and the file system being chosen is still the PC's, not the
 * phone's - so the same control opens the harness-side folder browser
 * (FolderBrowserDialog, plan step 6) instead of saying no: a fabricated path
 * that reaches the store is the bug this dialog used to be, and a note
 * refusing the gesture was only one degree better.
 *
 * ---- Trust ----------------------------------------------------------------
 *
 * The folders are also where the trust question belongs, because this is the
 * moment the person is looking at a directory and deciding to bring it in.
 * Until that question is answered a conversation standing in the folder can
 * only read, in every permission mode - so a project created without it looks
 * broken in a way nothing on the chat page explains. Left unanswered here it
 * stays unanswered rather than being assumed either way, and Environments is
 * where it can be answered later.
 */

/**
 * The folder's display name, from the directory the person picked.
 *
 * The last segment of the path, with any trailing separators stripped first
 * so `D:\Work\alpha\` names `alpha` and not the empty string. A volume root
 * (`C:\`) names itself, which is fine to show: the harness refuses that path
 * on write with a sentence that says why, and this dialog's job is to carry
 * the sentence, not to pre-judge the path.
 */
function nameFromPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '')
  const last = trimmed.split(/[\\/]/).pop()
  if (last === undefined || last === '') return path
  return last
}

/** What the dialog owes the person that is not a folder row. */
type Notice =
  | { readonly kind: 'note'; readonly text: string }
  | { readonly kind: 'refusal'; readonly text: string }

export function NewProjectDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { createProject, trustFolders } = useWorkspace()
  const { openProject } = useNavigation()

  const [name, setName] = useState('')
  const [icon, setIcon] = useState<ProjectIcon>(DEFAULT_PROJECT_ICON)
  const [description, setDescription] = useState('')
  const [folders, setFolders] = useState<{ name: string; path: string }[]>([])
  // Nothing is selected until the person selects it. A pre-ticked answer to
  // "do you vouch for this code" is not an answer, and the whole reason trust
  // is asked once about the folder is that it is meant to be deliberate.
  const [trusted, setTrusted] = useState<'trusted' | 'not-yet' | 'unanswered'>('unanswered')
  const [notice, setNotice] = useState<Notice | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // The harness-side folder browser, open when the native one does not exist.
  const [browsing, setBrowsing] = useState(false)

  // Whether the dialog is still open when the write's verdict arrives. The
  // submit button waits for the harness before closing, but Escape and the
  // overlay do not, and a verdict landing after the person gave up must not
  // navigate them into a project they walked away from.
  const openRef = useRef(open)
  openRef.current = open

  const valid = name.trim().length > 0 && folders.length > 0

  const reset = () => {
    setName('')
    setIcon(DEFAULT_PROJECT_ICON)
    setDescription('')
    setFolders([])
    setTrusted('unanswered')
    setNotice(null)
    setSubmitting(false)
    setBrowsing(false)
  }

  const close = () => {
    // Escape is bound at the document, so while the folder browser is open it
    // reaches both sheets. The answer it means there is "back out of the
    // walk", not "abandon the form" - the browser closes; the form waits.
    if (browsing) {
      setBrowsing(false)
      return
    }
    reset()
    onClose()
  }

  /** The shared landing for a picked directory, from either picker. */
  const attach = (picked: string) => {
    if (folders.some((folder) => folder.path.toLowerCase() === picked.toLowerCase())) {
      setNotice({ kind: 'note', text: 'A project cannot attach the same folder twice.' })
      return
    }
    setNotice(null)
    setFolders((current) => [...current, { name: nameFromPath(picked), path: picked }])
  }

  const addFolder = async () => {
    if (!isTauri()) {
      // No native dialog off the desktop, but the file system being chosen is
      // still the PC's: the harness lists it, and the browser dialog walks
      // the listing (plan step 6).
      setBrowsing(true)
      return
    }
    setNotice(null)
    const picked = await pickDirectory()
    // Cancelled: the most common outcome of opening a picker, and not a
    // failure - nothing appended, nothing raised.
    if (picked === null) return
    attach(picked)
  }

  const submit = () => {
    if (!valid || submitting) return
    setSubmitting(true)
    const { project, written } = createProject({ name, icon, description, folders })
    void written.then((refusal) => {
      // The person closed the dialog while the write was in flight: the
      // verdict is no longer theirs to see, and the project's row settles
      // with the store on its own.
      if (!openRef.current) return
      setSubmitting(false)
      if (refusal !== null) {
        // The harness's own sentence, verbatim: a refused system directory
        // names `trusted`, and paraphrasing it here would lose the remedy.
        setNotice({ kind: 'refusal', text: refusal.message })
        return
      }
      // After the project, never before: the answer is about folders this
      // person just attached, and writing it for a create that was refused
      // would leave a decision behind with nothing to explain it. A refusal
      // here is not worth holding the dialog open for - the project exists,
      // and Environments states the folder's decision plainly - so the
      // navigation happens either way.
      if (trusted === 'trusted') void trustFolders(folders.map((folder) => folder.path))
      reset()
      onClose()
      openProject(project.id)
    })
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="New project"
      width="28rem"
      footer={
        <>
          <Button variant="ghost" onClick={close} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid || submitting} onClick={submit}>
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
                <Icons.project />
                <span className="min-w-0 flex-1 truncate text-ui text-foreground">{folder.name}</span>
                <span className="hidden shrink-0 text-micro text-muted-foreground sm:block">
                  {folder.path}
                </span>
                <IconButton
                  label={`Remove ${folder.name}`}
                  size="sm"
                  onClick={() => setFolders((current) => current.filter((_, i) => i !== index))}
                >
                  <Icons.close size="sm" />
                </IconButton>
              </div>
            ))}

            <button
              type="button"
              aria-label="Add folder"
              onClick={() => void addFolder()}
              className="flex items-center justify-center gap-1.5 rounded-md border border-dashed py-2 text-ui text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
            >
              <Icons.add />
              Add folder
            </button>

            {notice?.kind === 'refusal' ? (
              <StateNote title="The harness refused that folder." detail={notice.text} />
            ) : notice !== null ? (
              <p className="text-caption text-muted-foreground">{notice.text}</p>
            ) : null}

            {folders.length === 0 ? (
              <p className="text-micro text-muted-foreground/80">
                A project needs at least one folder to work in.
              </p>
            ) : null}
          </div>
        </Field>

        {/* Not the `Field` above: that is a `label`, and a label wrapping a
            radio group hands its whole text to the first radio as that
            control's name. A heading and a group, which is what this is. */}
        {folders.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-caption text-muted-foreground">Trust</span>
            <div className="flex flex-col gap-1.5">
              <Segmented
                layoutId="new-project-trust"
                ariaLabel="Trust these folders"
                value={trusted}
                onChange={setTrusted}
                options={[
                  { id: 'trusted', label: 'I trust these folders' },
                  { id: 'not-yet', label: 'Not yet' },
                ]}
              />
              <p className="text-micro text-muted-foreground/80">
                {trusted === 'trusted'
                  ? 'Conversations here can edit files and run commands, subject to the permission mode they are set to.'
                  : 'Until a folder is trusted, conversations in this project can only read it - whatever permission mode they are set to. This can be answered later in Settings, under Environments.'}
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {/* Off the desktop the picker is this dialog's, not the OS's. It mounts
          beside the form rather than inside it: a modal over a modal is the
          arrangement every file dialog behind a form already uses. */}
      <FolderBrowserDialog
        open={browsing}
        onClose={() => setBrowsing(false)}
        onPick={attach}
      />
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
