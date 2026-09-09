import { cn } from '@/lib/cn'
import type { BrowserCallView } from './browserCall'

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
export function BrowserCard({ call }: { call: BrowserCallView }) {
  const { frame, url, title, said } = call

  return (
    <div className="flex flex-col gap-2">
      {url === null && title === null ? null : (
        <div className="flex min-w-0 flex-col gap-0.5">
          {title === null || title === '' ? null : (
            <span className="truncate text-sm font-medium">{title}</span>
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

      {frame === null ? null : (
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
            src={`data:${frame.mimeType};base64,${frame.data}`}
            alt={
              title === null
                ? 'The page as the browser saw it'
                : `${title}, as the browser saw it`
            }
            className="w-full object-contain object-top"
            draggable={false}
          />
        </div>
      )}

      {said === null ? null : (
        <pre className="studio-selectable max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere] font-mono text-code text-muted-foreground">
          {said}
        </pre>
      )}
    </div>
  )
}
