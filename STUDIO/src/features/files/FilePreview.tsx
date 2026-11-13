import { useEffect, useState } from 'react'
import { Icons } from '@/components/icons'
import { IconButton, Tooltip } from '@/components/primitives'
import { fileTypeOf, splitFilePath } from '@/components/icons/fileTypes'
import { CodeBlock } from '@/features/chat/markdown/blocks/CodeBlock'
import { Markdown } from '@/features/chat/markdown/Markdown'
import { ReplyConversation } from '@/features/chat/markdown/ReplyImage'
import { harnessBytesDataUrl } from '@/platform/harness'
import { useWorkspace } from '@/stores/workspace'
import { traitsOf } from './fileKinds'
import { FILE_VERB_ICONS } from './FileMenu'
import { useFileVerbs } from './useFileVerbs'
import type { LocatedFile } from './useLocatedFile'

type Content =
  | { readonly state: 'loading' }
  | { readonly state: 'failed' }
  | { readonly state: 'text'; readonly text: string; readonly truncated: boolean }
  | { readonly state: 'picture'; readonly url: string }

/**
 * A file shown in the side rail, which already opens as an overlay at the compact
 * window size, so the viewer costs no room of its own. It shows what the file
 * says now, read from disk, not what the reply remembered writing.
 */
export function FilePreview({ file, conversationId, source = false, revision = 0 }: {
  file: LocatedFile
  conversationId: string
  source?: boolean
  revision?: number
}) {
  const { readFileText } = useWorkspace()
  const { verbs, run, error, copied, copy } = useFileVerbs(file, null)
  const [content, setContent] = useState<Content>({ state: 'loading' })
  const mode = traitsOf(file.kind, file.path).preview

  useEffect(() => {
    let live = true
    setContent({ state: 'loading' })
    if (mode === 'picture') {
      const address = `/api/media/workspace/${encodeURIComponent(conversationId)}?path=${encodeURIComponent(file.path)}`
      void harnessBytesDataUrl(address, 'image/png', { sniff: true }).then((url) => {
        if (live) setContent(url === null ? { state: 'failed' } : { state: 'picture', url })
      })
    } else {
      void readFileText(conversationId, file.path).then((result) => {
        if (!live) return
        setContent(result.ok && result.value !== null
          ? { state: 'text', text: result.value.text, truncated: result.value.truncated }
          : { state: 'failed' })
      })
    }
    return () => { live = false }
  }, [conversationId, file.path, mode, readFileText, revision])

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-1">
        <Tooltip label={file.path} overflowOnly className="min-w-0 flex-1">
          <span className="truncate text-caption text-muted-foreground">{file.path}</span>
        </Tooltip>
        {verbs.map((verb) => {
          const Mark = FILE_VERB_ICONS[verb.icon]
          return <IconButton key={verb.id} size="sm" label={verb.label} onClick={() => { void run(verb) }}><Mark size="sm" /></IconButton>
        })}
        <IconButton size="sm" label={copied ? 'Copied' : 'Copy path'} active={copied} onClick={() => copy(file.path)}>
          {copied ? <Icons.check size="sm" /> : <Icons.copy size="sm" />}
        </IconButton>
      </div>
      {error !== null ? <p role="alert" className="text-caption text-danger">{error}</p> : null}
      {content.state === 'loading' ? <p className="text-caption text-muted-foreground">Loading…</p> : null}
      {content.state === 'failed' ? <p className="text-caption text-muted-foreground">This file cannot be shown here.</p> : null}
      {content.state === 'picture'
        ? <img src={content.url} alt={splitFilePath(file.path).name} className="w-full rounded-md object-contain" />
        : null}
      {content.state === 'text' ? (
        <ReplyConversation.Provider value={conversationId}>
          {mode === 'markdown' && !source
            ? <div className="studio-prose min-w-0"><Markdown text={content.text} /></div>
            : <CodeBlock code={content.text} fence={fileTypeOf(file.path) ?? 'text'} />}
          {content.truncated ? <p className="text-caption text-muted-foreground">Showing the start of this file.</p> : null}
        </ReplyConversation.Provider>
      ) : null}
    </div>
  )
}
