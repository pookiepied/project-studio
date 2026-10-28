import { useState, type KeyboardEvent, type ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { Button, Popover } from '@/components/primitives'
import { copyText } from '@/lib/clipboard'
import { openExternalUrl, webUrl } from '@/platform/tauri/external'

/**
 * A link in a reply: one small capsule, the destination's name on the left
 * and an Open pill at its end. Citations and plain links share it -- a chip
 * names its source by site already, and the capsule says the rest.
 *
 * The anchor carries no `href` and no `title`. Either one hands the pointer
 * to the webview's own chrome: `title` drew the OS tooltip, and an `href`
 * made the webview print the full address in its status bubble on hover.
 * The capsule is the only hint, and it opens on click. Nothing here fetches
 * the site; the name shown is the reply's own words or the address.
 */
export function MarkdownLink({ href, title, children }: { href?: string; title?: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState(false)
  const [copied, setCopied] = useState(false)
  const url = href === undefined ? null : webUrl(href)
  if (href?.startsWith('#')) return <a href={href}>{children}</a>
  if (url === null) return <span>{children}</span>
  const site = new URL(url).host.replace(/^www\./, '')
  const citation = typeof children === 'string' && /^\[?\d+(?:[,\s-]+\d+)*\]?$/.test(children)
  // A bare address printed as its own text (`https://...` autolinked) says the
  // same thing as its host, at a fraction of the width; the full address is
  // one click away in the capsule.
  const bare = typeof children === 'string' && children.replace(/\/$/, '') === url.replace(/\/$/, '')
  // The name the capsule shows: the source's own title where the reply gave
  // one, otherwise the address without its scheme.
  const name = title ?? url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')

  const toggle = () => { setOpen((value) => !value); setError(false); setCopied(false) }
  const launch = () => {
    setError(false)
    void openExternalUrl(url).then(() => setOpen(false), () => setError(true))
  }
  const copy = () => {
    void copyText(url).then((done) => setCopied(done), () => setCopied(false))
  }
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    toggle()
  }

  return <Popover inline open={open} onOpenChange={setOpen}
    className="min-w-0 max-w-[min(22rem,calc(100vw-1rem))] rounded-full p-1"
    trigger={
      <a role="link" tabIndex={0} aria-haspopup="menu" aria-expanded={open}
        aria-label={citation ? `Source ${children}: ${site}` : bare ? url : undefined}
        className={citation ? 'studio-citation' : bare ? 'studio-bare-link' : 'studio-link'}
        onClick={toggle} onKeyDown={onKeyDown}>
        {citation || bare ? site : children}
      </a>
    }>
    <div className="flex min-w-0 items-center gap-2 pl-2.5">
      {error ? (
        <p role="alert" className="min-w-0 flex-1 truncate text-caption text-danger">
          {copied ? 'Link copied' : 'Could not open your browser'}
        </p>
      ) : (
        <p className="min-w-0 flex-1 truncate text-caption text-foreground">{name}</p>
      )}
      {error ? (
        <Button role="menuitem" size="xs" variant="secondary" onClick={copy}>Copy link</Button>
      ) : (
        <Button role="menuitem" size="xs" variant="primary" onClick={launch} label={`Open ${site} in your browser`}>
          Open
          <Icons.openLink size="xs" />
        </Button>
      )}
    </div>
  </Popover>
}
