import { useContext, useState } from 'react'
import { Popover } from '@/components/primitives'
import { FileTypeMark, fileToneClass, splitFilePath } from '@/components/icons/fileTypes'
import { ReplyConversation } from '@/features/chat/markdown/ReplyImage'
import { cn } from '@/lib/cn'
import { useSheetHost } from '@/features/chat/sheet/sheet'
import { useWorkspacePanel } from '@/features/workspace/WorkspacePanelProvider'
import { FileMenu } from './FileMenu'
import { namesFolder, type PathReference } from './pathReference'
import { useLocatedFile } from './useLocatedFile'

/**
 * A path a reply mentions, made useful without being made dangerous.
 *
 * The chip keeps the text the reply wrote - name, directory, a `:42:7` suffix if
 * it carried one - and clicking it opens a small menu of what can be done with
 * that file. Finding the file and offering verbs happen only then: while a reply
 * is streaming the caller renders the plain chip, so a half-arrived path is never
 * interactive, and a transcript full of paths reads nothing from disk.
 *
 * A path the model emitted becomes an action only through a person's click on a
 * row, and the native side still decides whether that action may happen.
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
  return <InteractiveFileReference key={`${conversationId}:${reference.raw}`} reference={reference} variant={variant} conversationId={conversationId} />
}

function InteractiveFileReference({ reference, variant, conversationId }: {
  reference: PathReference
  variant: 'chip' | 'caption'
  conversationId: string | null
}) {
  const [open, setOpen] = useState(false)
  const sheet = useSheetHost()
  const workspacePanel = useWorkspacePanel()
  // Parsed afresh on each render above; this component is keyed by the text, so
  // the first parse stands and a parent's re-render does not repeat the lookup.
  const [pinned] = useState(reference)
  const lookup = useLocatedFile(pinned, conversationId, open)

  const { name, dir } = splitFilePath(reference.raw)
  // The chip keeps the reference in the order the reply wrote it - it sits
  // mid-sentence, and reordering the words ("chart.png workspace") would
  // scramble the sentence to no gain. The directory half reads muted, the
  // file's own name in full colour; the caption variant leads with the name
  // instead, which is the block header's own convention.
  const separator = Math.max(reference.raw.lastIndexOf('/'), reference.raw.lastIndexOf('\\'))
  const head = separator === -1 ? null : reference.raw.slice(0, separator + 1)
  const tail = reference.raw.slice(separator + 1)

  const located = lookup.state === 'found' ? lookup.file : null
  const preview = conversationId !== null && located !== null
    ? sheet !== null
      ? () => { sheet.open({ kind: 'file', file: located, conversationId }) }
      : workspacePanel?.conversationId === conversationId ? () => workspacePanel.openFile(located) : null
    : null

  // `chip` is the inline-code presentation, a `code` element so the existing
  // prose styling keeps applying; `caption` is the block header's, where a
  // chip inside the frame would be a box in a box.
  const Wrapper = variant === 'caption' ? 'span' : 'code'
  const folder = namesFolder(reference)
  return (
    <Wrapper className={variant === 'caption' ? 'inline-flex min-w-0 max-w-full' : cn('studio-file-reference', fileToneClass(reference.target, folder))}>
      <Popover inline open={open} onOpenChange={setOpen}
        className="w-52"
        trigger={
          <button type="button" aria-haspopup="menu" aria-expanded={open}
            className="inline-flex min-w-0 max-w-full cursor-pointer items-baseline gap-0 rounded-xs text-left [font:inherit] text-inherit underline-offset-2 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => setOpen((value) => !value)}>
            {variant === 'caption' ? (
              <>
                <span className="min-w-0 truncate">{name}</span>
                {dir !== null ? <span className="ml-1.5 min-w-0 truncate font-normal text-muted-foreground">{dir}</span> : null}
              </>
            ) : (
              <>
                <FileTypeMark path={reference.target} folder={folder} className="mr-1.5 self-center" />
                {head !== null ? <span className="min-w-0 truncate font-normal text-muted-foreground">{head}</span> : null}
                <span className="min-w-0 truncate">{tail}</span>
              </>
            )}
          </button>
        }>
        <FileMenu lookup={lookup} written={reference.target} onPreview={preview} onDone={() => setOpen(false)} />
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
