import { cn } from '@/lib/cn'
import { MarkdownLink } from '../MarkdownLink'
import { ReplyImage, replyImageSource } from '../ReplyImage'
import { formatValue, type CardsVisual, type ProgressVisual, type StatsVisual, type TimelineVisual } from './parse'
import { VisualFrame } from './VisualFrame'

/**
 * The visuals that are not plots: figures, progress, a sequence, a shelf of
 * things. Each is mostly type and white space; the only colour is the delta's
 * direction, which always travels with an arrow so it never rests on hue.
 */

export function Stats({ stats }: { stats: StatsVisual }) {
  return (
    <VisualFrame title={stats.title}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-x-6 gap-y-5">
        {stats.items.map((stat, index) => (
          <div key={stat.label + index} className="min-w-0">
            <div className="truncate text-caption text-muted-foreground">{stat.label}</div>
            {/* The serif at figure size: a number on a page, not a reading on a dial. */}
            <div className="mt-1 truncate font-display text-[calc(var(--ui-size)+16px)] leading-[1.1] tabular-nums text-foreground">
              {stat.value}
            </div>
            {stat.delta !== undefined ? (
              <div
                className={cn(
                  'mt-1 text-caption font-medium tabular-nums',
                  stat.tone === 'good' ? 'text-diff-add' : stat.tone === 'bad' ? 'text-danger' : 'text-muted-foreground',
                )}
              >
                {arrow(stat.delta)}{stat.delta.replace(/^[\u2191\u2193]\s*/, '')}
              </div>
            ) : null}
            {stat.note !== undefined ? <div className="mt-0.5 text-caption text-muted-foreground">{stat.note}</div> : null}
          </div>
        ))}
      </div>
    </VisualFrame>
  )
}

function arrow(delta: string): string {
  if (/^\s*[-\u2212\u2193]/.test(delta)) return '\u2193 '
  if (/^\s*[+\u2191]/.test(delta)) return '\u2191 '
  return ''
}

export function Progress({ progress }: { progress: ProgressVisual }) {
  return (
    <VisualFrame title={progress.title}>
      <div className="flex flex-col gap-4">
        {progress.items.map((item, index) => {
          const share = Math.max(0, Math.min(100, (item.value / item.max) * 100))
          const reading = item.max === 100 ? `${formatValue(item.value)}%` : `${formatValue(item.value)} of ${formatValue(item.max)}`
          return (
            <div key={item.label + index} className="min-w-0">
              <div className="mb-1.5 flex items-baseline gap-3 text-caption">
                <span className="min-w-0 flex-1 truncate text-foreground">{item.label}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{reading}</span>
              </div>
              <div
                role="progressbar"
                aria-label={item.label}
                aria-valuemin={0}
                aria-valuemax={item.max}
                aria-valuenow={item.value}
                className="h-1.5 w-full overflow-hidden rounded-full bg-selected"
              >
                <div className="h-full rounded-full bg-foreground" style={{ width: `${share}%` }} />
              </div>
              {item.note !== undefined ? <div className="mt-1 text-caption text-muted-foreground">{item.note}</div> : null}
            </div>
          )
        })}
      </div>
    </VisualFrame>
  )
}

export function Timeline({ timeline }: { timeline: TimelineVisual }) {
  return (
    <VisualFrame title={timeline.title}>
      <ol className="!m-0 !list-none !p-0">
        {timeline.items.map((item, index) => {
          const last = index === timeline.items.length - 1
          return (
            <li key={item.title + index} className="relative !mt-0 flex gap-3 pb-4 last:pb-0" aria-current={item.status === 'current' ? 'step' : undefined}>
              {/* The rail: a mark per step and a hairline joining them. */}
              <div aria-hidden className="relative flex w-3 shrink-0 justify-center">
                {!last ? <span className="absolute bottom-[-2px] top-4 w-px bg-hairline" /> : null}
                <span
                  className={cn(
                    'relative mt-[0.4rem] size-2.5 rounded-full',
                    item.status === 'done' && 'bg-foreground',
                    item.status === 'current' && 'bg-surface-raised ring-2 ring-foreground ring-inset',
                    item.status === 'upcoming' && 'bg-surface-raised ring-1 ring-muted-foreground/50 ring-inset',
                  )}
                />
              </div>
              <div className="min-w-0 flex-1">
                {item.date !== undefined ? <div className="text-caption tabular-nums text-muted-foreground">{item.date}</div> : null}
                <div className={cn('text-ui font-medium', item.status === 'upcoming' ? 'text-muted-foreground' : 'text-foreground')}>
                  {item.title}
                </div>
                {item.detail !== undefined ? <div className="mt-0.5 text-caption text-muted-foreground">{item.detail}</div> : null}
              </div>
            </li>
          )
        })}
      </ol>
    </VisualFrame>
  )
}

/**
 * A shelf of things -- products, places, papers. No outer sheet: each card is
 * its own white tile, the way a shop window is a row of objects rather than a
 * box with objects in it. The link is the title, through the same capsule
 * every link in a reply opens.
 */
export function Cards({ cards }: { cards: CardsVisual }) {
  return (
    <section className="my-5 w-full min-w-0">
      {cards.title !== undefined ? <div className="studio-heading mb-3 text-foreground">{cards.title}</div> : null}
      <div className="grid grid-cols-[repeat(auto-fill,minmax(10.5rem,1fr))] gap-3">
        {cards.items.map((card, index) => (
          <article key={card.title + index} className="flex min-w-0 flex-col overflow-hidden rounded-2xl bg-surface-raised shadow-raised">
            {card.image !== undefined ? (
              <div className="aspect-[4/3] w-full overflow-hidden bg-surface-sunken">
                <ReplyImage src={replyImageSource(card.image)} alt={card.title} fill />
              </div>
            ) : null}
            <div className="flex min-w-0 flex-1 flex-col gap-0.5 p-3">
              <div className="line-clamp-2 text-ui font-medium text-foreground">
                {card.url !== undefined ? <MarkdownLink href={card.url} title={card.title}>{card.title}</MarkdownLink> : card.title}
              </div>
              {card.subtitle !== undefined ? <div className="truncate text-caption text-muted-foreground">{card.subtitle}</div> : null}
              {card.detail !== undefined ? <div className="mt-1 line-clamp-3 text-caption text-muted-foreground">{card.detail}</div> : null}
              {card.tags.length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {card.tags.map((tag) => <span key={tag} className="rounded-full bg-selected px-2 py-px text-micro text-muted-foreground">{tag}</span>)}
                </div>
              ) : null}
              {card.price !== undefined || card.rating !== undefined ? (
                <div className="mt-auto flex items-baseline gap-2 pt-2 text-caption">
                  {card.price !== undefined ? <span className="font-medium tabular-nums text-foreground">{card.price}</span> : null}
                  {card.rating !== undefined ? (
                    <span className="ml-auto tabular-nums text-muted-foreground" aria-label={`Rated ${card.rating} out of 5`}>{'\u2605'} {card.rating.toFixed(1)}</span>
                  ) : null}
                </div>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
