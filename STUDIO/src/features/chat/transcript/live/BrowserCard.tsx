import { cn } from '@/lib/cn'
import { useState } from 'react'
import { ShowMoreButton } from '@/components/primitives'
import { MediaLightbox } from '@/features/artifacts/media/MediaLightbox'
import { useAttachmentFrame } from '@/features/chat/useAttachmentFrame'
import type { BrowserCallView } from './browserCall'
import { BROWSER_FAMILY, type ReportFamily } from './reportFamily'

/**
 * A browser call, shown as a report of a browser.
 *
 * ADR 0049 §7, in a component: **this is a preview and not a browser.** There
 * is no address bar, no back button and no way to browse by hand, and that is
 * a decision rather than an omission. Those need history, cookies, profiles, a
 * download policy and a clear-data control — a second product inside this one,
 * built for a person who has a real browser one keystroke away.
 *
 * What it does show is the three things a person actually wants while a model
 * is working: where the page is, what was just done to it, and what it looked
 * like immediately afterwards.
 */
export function BrowserCard({
  call,
  conversationId,
  family = BROWSER_FAMILY,
  preview = 'full',
}: {
  call: BrowserCallView
  /** The conversation the call ran in, which keys its attachments. */
  conversationId: string
  /** Which capability the call belongs to; it words the picture. */
  family?: ReportFamily
  preview?: 'full' | 'thumbnail'
}) {
  const { frame, url, title, said } = call
  const frameUrl = useAttachmentFrame(conversationId, frame)
  const [open, setOpen] = useState(false)
  const [showOutput, setShowOutput] = useState(false)
  const outputPreview = said?.split('\n', 7).slice(0, 6).join('\n').slice(0, 480).trimEnd()
  const hasMore = outputPreview !== undefined && outputPreview.length < (said?.trimEnd().length ?? 0)

  return (
    <div className="flex flex-col gap-2">
      {url === null && title === null ? null : (
        <div className="flex min-w-0 flex-col gap-0.5">
          {title === null || title === '' ? null : (
            <span className="truncate text-ui font-medium">{title}</span>
          )}
          {url === null ? null : (
            // Not a link. Opening it would hand the page to the person's real
            // browser with their real cookies, which is a different act from
            // the one they are watching, and one they did not ask for.
            <span className="studio-selectable truncate font-mono text-code text-muted-foreground">
              {url}
            </span>
          )}
        </div>
      )}

      {/* No frame URL is no image element — an attachment still being
          fetched and one the harness cannot produce both read as a card
          without its picture, because a broken-image glyph claims the bytes
          were here and failed to draw, which is never the truth. */}
      {frameUrl === null ? null : preview === 'thumbnail' ? (
        <>
          <button type="button" aria-label={`Preview screenshot: ${title ?? family.label}`}
            onClick={() => setOpen(true)} className="w-32 overflow-hidden rounded-md border border-border bg-background">
            <img src={frameUrl} alt={title ?? family.pictureOf} className="h-20 w-32 object-contain" draggable={false} />
          </button>
          <MediaLightbox open={open} onClose={() => setOpen(false)} title={title ?? family.label}
            video={false} output={{ url: frameUrl, ratio: null }} />
        </>
      ) : (
        <div
          className={cn(
            'overflow-hidden rounded-md border border-border bg-background',
            // A frame is a small JPEG of a wide page, so it is shown at the
            // width it is given and allowed to be as tall as it is. Cropping
            // it would hide exactly the part a person is checking.
            'max-h-[28rem]',
          )}
        >
          <img
            src={frameUrl}
            alt={title === null ? family.pictureOf : `${title}, ${family.pictureOf}`}
            className="w-full object-contain object-top"
            draggable={false}
          />
        </div>
      )}

      {said === null ? null : <>
        <pre className="studio-selectable whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-code text-muted-foreground">
          {hasMore && !showOutput ? `${outputPreview}…` : said}
        </pre>
        {hasMore ? <ShowMoreButton expanded={showOutput} onToggle={() => setShowOutput((value) => !value)}
          moreLabel="Show full output" lessLabel="Show less" className="self-start" /> : null}
      </>}
    </div>
  )
}
