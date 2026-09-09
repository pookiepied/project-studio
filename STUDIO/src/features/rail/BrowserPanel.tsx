import type { RailEntry } from '@/stores/rail'

/**
 * The browser preview, at a size worth looking at.
 *
 * The transcript row shows a frame inline because a reader following the work
 * wants to see it happen. This is the same frame with room around it, for when
 * somebody actually wants to *look* — at a layout, at a font, at whether the
 * mobile breakpoint did what it was supposed to do.
 *
 * **It is a preview and not a browser** (ADR 0049 §7). No address bar, no back
 * button, nothing clickable. Those need history, cookie and profile
 * management, a download policy and a clear-data control, which is a second
 * product inside this one — built for a person who has a real browser one
 * keystroke away. What is here instead is the sequence: where the page is, and
 * what the model has done to it.
 */
export function BrowserPanel({
  entry,
}: {
  entry: Extract<RailEntry, { kind: 'browser' }>
}) {
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate text-sm font-medium">
          {entry.title === null || entry.title === '' ? 'No page open' : entry.title}
        </span>
        {entry.url === null ? null : (
          // Deliberately not a link. Following it would open the page in the
          // person's real browser, with their real cookies — a different act
          // from the one they are watching, and one they did not ask for.
          <span className="studio-selectable truncate font-mono text-code text-muted-foreground">
            {entry.url}
          </span>
        )}
      </div>

      {entry.frame === null ? (
        <p className="text-caption text-muted-foreground">
          The browser has not sent a picture yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <img
            src={`data:${entry.frame.mimeType};base64,${entry.frame.data}`}
            alt={
              entry.title === null
                ? 'The page as the browser saw it'
                : `${entry.title}, as the browser saw it`
            }
            className="w-full object-contain object-top"
            draggable={false}
          />
        </div>
      )}

      {entry.steps.length === 0 ? null : (
        <div className="flex flex-col gap-1">
          <span className="text-caption text-muted-foreground">What happened</span>
          <ol className="flex flex-col gap-0.5">
            {/* Newest last, because that is the order it happened in and the
                bottom of a list is where a reader looks for "now". */}
            {entry.steps.map((step, index) => (
              <li
                key={`${String(index)}-${step}`}
                className="studio-selectable truncate text-caption text-muted-foreground"
              >
                {step}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  )
}
