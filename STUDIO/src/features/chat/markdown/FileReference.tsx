import { useContext, useState } from 'react'
import { Icons } from '@/components/icons'
import { IconButton, Popover } from '@/components/primitives'
import { FileTypeMark, fileToneClass, splitFilePath } from '@/components/icons/fileTypes'
import { cn } from '@/lib/cn'
import { copyText } from '@/lib/clipboard'
import { isTauri } from '@/platform/tauri/window'
import { revealPath } from '@/platform/tauri/reveal'
import { useConversationWorkspaceRoot } from './useWorkspaceRoot'
import { namesFolder, resolvePathReference, type PathReference } from './pathReference'
import { ReplyConversation } from './ReplyImage'

/**
 * A path a reply mentions, made useful without being made dangerous.
 *
 * The chip keeps the text the reply wrote - name, directory, a `:42:7`
 * suffix if it carried one - and adds exactly two verbs, both of them the
 * person's own: clicking the name opens a small panel with the full path,
 * selectable and copyable, and the folder mark opens that place in Windows
 * File Explorer directly.
 *
 * ---- The line this feature does not cross --------------------------------
 *
 * Reveal is navigation. A file - an `.exe`, a `.bat`, a shortcut, an
 * archive - is opened *in* its folder and selected there, never opened
 * itself; the native side enforces that and this component never asks for
 * anything else. A path the model emitted becomes an action only when the
 * person clicks one of the two verbs; while the reply is still streaming
 * the caller renders the plain chip, so a half-arrived path is never
 * interactive and nothing probes the filesystem on the way.
 *
 * The panel is a Popover, not a tooltip or a `title`: a path's details are
 * content a person reads, selects and copies, not a hover afterthought -
 * the same reading `MarkdownLink` reached for web addresses.
 */
export function FileReference({ reference, variant = 'chip', streaming = false }: {
  reference: PathReference
  variant?: 'chip' | 'caption'
  streaming?: boolean
}) {
  const conversationId = useContext(ReplyConversation)
  const folder = namesFolder(reference)
  if (streaming) return variant === 'caption'
    ? <FilePathLabel path={reference.raw} />
    : <code className={cn('studio-file-reference', fileToneClass(reference.target, folder))}>
        <span className="inline-flex min-w-0 max-w-full items-baseline">
          <FileTypeMark path={reference.target} folder={folder} className="mr-1.5 self-center" />
          <span className="min-w-0 truncate">{reference.raw}</span>
        </span>
      </code>
  return <InteractiveFileReference key={`${conversationId}:${reference.raw}`} reference={reference} variant={variant} />
}

function InteractiveFileReference({ reference, variant }: { reference: PathReference; variant: 'chip' | 'caption' }) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const workspaceRoot = useConversationWorkspaceRoot()

  const resolved = resolvePathReference(reference, workspaceRoot)
  const { name, dir } = splitFilePath(reference.raw)
  // The chip keeps the reference in the order the reply wrote it - it sits
  // mid-sentence, and reordering the words ("chart.png workspace") would
  // scramble the sentence to no gain. The directory half reads muted, the
  // file's own name in full colour; the caption variant leads with the name
  // instead, which is the block header's own convention.
  const separator = Math.max(reference.raw.lastIndexOf('/'), reference.raw.lastIndexOf('\\'))
  const head = separator === -1 ? null : reference.raw.slice(0, separator + 1)
  const tail = reference.raw.slice(separator + 1)

  // Where reveal cannot be offered at all, the panel says why instead of
  // offering a button that can only fail. A network path is another
  // computer's filesystem; a POSIX path is not a Windows path; a relative
  // one without a known workspace has no place to resolve against; and a
  // browser tab has no File Explorer to open - where the path details and
  // the copy stay, because they never claimed a desktop.
  const unavailable = !isTauri()
    ? 'Opening File Explorer needs the Studio desktop app.'
    : reference.kind === 'network' || (resolved !== null && /^[\\/]{2}/.test(resolved))
      ? 'That path is on another computer, so it cannot be shown here.'
      : reference.kind === 'unix'
        ? 'That path is not available on this computer.'
        : resolved === null
          ? 'Folder unknown.'
          : null

  // The full path the panel shows and copies: resolved where it can be,
  // exactly what the reply named where it cannot. The chip keeps the
  // reference as written; this is the answer to "what is this, really".
  const fullPath = resolved ?? reference.target

  const toggle = () => { setOpen((value) => !value); setError(null); setCopied(false) }
  const copy = () => {
    void copyText(fullPath).then((done) => setCopied(done), () => setCopied(false))
  }
  const reveal = () => {
    if (resolved === null || busy) return
    setBusy(true)
    setError(null)
    void revealPath(resolved).then(
      () => { setBusy(false); setOpen(false) },
      // A refusal surfaces in the panel - including from the folder mark,
      // which was clicked with the panel closed: opening it is how the
      // failure says what happened instead of failing silently.
      (failure: unknown) => {
        setBusy(false)
        setError(typeof failure === 'string' && failure !== '' ? failure : 'File Explorer could not be opened.')
        setOpen(true)
      },
    )
  }
  // `chip` is the inline-code presentation, a `code` element so the existing
  // prose styling keeps applying; `caption` is the block header's, where a
  // chip inside the frame would be a box in a box. One component, two
  // surfaces, the same two verbs.
  const Wrapper = variant === 'caption' ? 'span' : 'code'
  const folder = namesFolder(reference)
  return (
    <Wrapper className={variant === 'caption' ? 'inline-flex min-w-0 max-w-full' : cn('studio-file-reference', fileToneClass(reference.target, folder))}>
      <Popover inline open={open} onOpenChange={setOpen}
        maxWidth="18rem"
        trigger={
          <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
            <button type="button" aria-haspopup="menu" aria-expanded={open}
              className="inline-flex min-w-0 max-w-full cursor-pointer items-baseline gap-0 rounded-xs text-left [font:inherit] text-inherit underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              onClick={toggle}>
              {variant === 'caption' ? (
                <>
                  <span className="min-w-0 truncate">{name}</span>
                  {dir !== null ? <span className="min-w-0 truncate font-normal text-muted-foreground">{dir}</span> : null}
                </>
              ) : (
                <>
                  <FileTypeMark path={reference.target} folder={folder} className="mr-1.5 self-center" />
                  {head !== null ? <span className="min-w-0 truncate font-normal text-muted-foreground">{head}</span> : null}
                  <span className="min-w-0 truncate">{tail}</span>
                </>
              )}
            </button>
            {unavailable === null ? (
              <button type="button" aria-label={`Show ${reference.raw} in File Explorer`} disabled={busy} aria-busy={busy}
                title="Open folder in File Explorer"
                className="inline-flex size-5 shrink-0 cursor-pointer items-center justify-center self-center rounded-xs text-muted-foreground transition-colors duration-fast outline-none hover:bg-tint hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
                onClick={reveal}>
                <Icons.projectOpen size="xs" />
              </button>
            ) : null}
          </span>
        }>
        <div className="flex min-w-0 flex-col gap-2 p-1.5">
          <p className="max-h-24 min-w-0 select-text overflow-auto break-all rounded-xs bg-muted px-2 py-1.5 font-mono text-caption text-foreground">{fullPath}</p>
          {reference.line !== null ? (
            <p className="text-caption text-muted-foreground">
              Line {reference.line}{reference.column !== null ? `, column ${reference.column}` : ''}
            </p>
          ) : null}
          {error !== null ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
          {unavailable !== null ? <p className="text-caption text-muted-foreground">{unavailable}</p> : null}
          <div className="flex flex-wrap items-center gap-1.5">
            <IconButton role="menuitem" size="sm" label={copied ? 'Copied' : 'Copy path'} active={copied} onClick={copy}>
              {copied ? <Icons.check size="sm" /> : <Icons.copy size="sm" />}
            </IconButton>
            {unavailable === null ? (
              <IconButton role="menuitem" size="sm" label="Open folder in File Explorer" disabled={busy} onClick={reveal}>
                <Icons.projectOpen size="sm" />
              </IconButton>
            ) : null}
          </div>
        </div>
      </Popover>
    </Wrapper>
  )
}

/**
 * The chip without the verbs: the same name-and-directory reading, rendered
 * while a reply is still streaming and for the rare caption text that is not
 * a reference at all. No `title` - a hover hint that shows less than the
 * panel would, and hides it from touch and keyboard entirely, is not worth
 * the chrome it borrows.
 */
export function FilePathLabel({ path }: { path: string }) {
  const { name, dir } = splitFilePath(path)
  return (
    <span className="inline-flex min-w-0 max-w-full items-baseline gap-1.5">
      <span className="shrink-0">{name}</span>
      {dir !== null ? <span className="min-w-0 truncate font-normal text-muted-foreground">{dir}</span> : null}
    </span>
  )
}
