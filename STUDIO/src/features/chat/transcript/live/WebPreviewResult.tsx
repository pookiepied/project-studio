import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Button, MenuItem, MenuSeparator, Popover, Tooltip } from '@/components/primitives'
import { copyText } from '@/lib/clipboard'
import { openExternalUrl } from '@/platform/tauri/external'
import { useAttachmentFrame } from '@/features/chat/useAttachmentFrame'
import type { BrowserResultView } from './browserResults'

export function WebPreviewResult({ preview, conversationId }: {
  preview: BrowserResultView; conversationId: string
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const frameUrl = useAttachmentFrame(conversationId, preview.frame)
  const openBrowser = () => {
    setMenuOpen(false)
    setError(null)
    void openExternalUrl(preview.url).catch(() => setError('Could not open the browser. Copy the link to open it manually.'))
  }
  const copy = () => {
    setMenuOpen(false)
    setError(null)
    void copyText(preview.url).then((copied) => {
      if (copied) setNotice('Link copied')
      else setError('Could not copy the link.')
    })
  }
  return <section aria-label="Web preview" className="min-w-0 overflow-hidden rounded-xl bg-muted/60 text-caption text-foreground">
    <div className="flex min-w-0 items-center gap-3 p-3">
      <Tooltip label={preview.url} className="min-w-0 flex-1"><button type="button" onClick={() => openBrowser()} aria-label={`Open web preview: ${preview.title}`}
        className="group/preview flex min-w-0 flex-1 items-center gap-3 rounded-md text-left">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-background text-muted-foreground"><Icons.browserUse size="lg" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-medium group-hover/preview:underline">Web preview</span>
          <span className="block truncate text-muted-foreground">Website · {preview.title}</span>
        </span>
      </button></Tooltip>
      <Popover open={menuOpen} onOpenChange={setMenuOpen} align="end"
        trigger={<Button size="xs" hasPopup="menu" expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
          Open in<Icons.dropdown />
        </Button>}>
        <MenuItem icon={<Icons.openExternal />} onSelect={openBrowser}>Default browser</MenuItem>
        <MenuSeparator />
        <MenuItem icon={<Icons.copy />} onSelect={copy}>Copy link</MenuItem>
      </Popover>
    </div>
    {frameUrl !== null ? <button type="button" onClick={() => openBrowser()} aria-label="Expand website preview" className="block w-full px-3 pb-3">
      <img src={frameUrl} alt={`${preview.title}, website preview`} className="max-h-56 w-full rounded-lg object-cover object-top" />
    </button> : null}
    {error !== null ? <p role="alert" className="px-3 pb-3 text-danger">{error}</p> : null}
    {notice !== null ? <p role="status" className="px-3 pb-3 text-muted-foreground">{notice}</p> : null}
  </section>
}
