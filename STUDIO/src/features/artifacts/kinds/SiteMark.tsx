import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { harnessBytesDataUrl } from '@/platform/harness'
import { hostOf } from '@/lib/url'

/**
 * A site's mark beside a source: its own icon, or its first letter.
 *
 * The icon is the one a browser's tab shows, and it names a site faster
 * than its host does - a reader knows the GitHub mark before reading
 * "github.com". It is asked of the harness, never the site: the harness
 * fetches each host's icon once and keeps it (`STUDIO HARNESS/src/web/
 * favicons.ts`), so a transcript full of sources costs the network nothing
 * on a re-read and tells no third party what is being read.
 *
 * The letter stands first and stays when there is no icon: a site with no
 * mark, a harness that is not reachable, a lookup that has not come back.
 * The icon fades in over it when it lands, so a list of sources never
 * flickers between two kinds of mark as the lookups settle.
 */
export function SiteMark({ href }: { href: string }) {
  const host = hostOf(href)
  const icon = useSiteIcon(host)
  const [broken, setBroken] = useState(false)
  const shown = icon !== null && !broken

  return (
    // The outer box is one line of the result's title tall, so the disc
    // centres on that line instead of being nudged down toward it. The disc
    // keeps its own size on the inside — it is a shape, not a glyph, and it
    // should not resize with the line it happens to sit on.
    <span aria-hidden className="flex h-[1lh] shrink-0 items-center text-ui">
      <span className="relative flex size-5 items-center justify-center overflow-hidden rounded-full bg-selected text-micro font-semibold text-muted-foreground">
        {host.charAt(0).toUpperCase()}
        {shown ? (
          <motion.img
            src={icon}
            alt=""
            draggable={false}
            onError={() => setBroken(true)}
            className="absolute inset-0 size-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: DURATION.base, ease: EASE_OUT }}
          />
        ) : null}
      </span>
    </span>
  )
}

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i

/** The site's icon as a `data:` URL, or null while there is none to show. */
function useSiteIcon(host: string): string | null {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!HOST.test(host)) return
    let cancelled = false
    setUrl(null)
    void harnessBytesDataUrl(`/api/web/favicons/${host.toLowerCase()}`, 'image/x-icon', { sniff: true }).then(
      (resolved) => {
        if (!cancelled) setUrl(resolved)
      },
    )
    return () => {
      cancelled = true
    }
  }, [host])
  return url
}
