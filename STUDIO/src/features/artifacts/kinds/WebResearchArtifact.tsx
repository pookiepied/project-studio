import { useState } from 'react'
import { Icons } from '@/components/icons'
import { WorkingDots } from '@/components/state'
import { AnimatedItem, AnimatedList } from '@/features/artifacts/ArtifactMotion'
import { ArtifactShell } from '@/features/artifacts/ArtifactShell'
import { StatusDot } from '@/features/artifacts/sections/StatusDot'
import { Timeline } from '@/features/artifacts/sections'
import { hostOf } from '@/lib/url'
import { cn } from '@/lib/cn'
import { researchOf, type ReadStep, type ResearchHit, type ResearchStep, type SearchStep } from '@/domain/artifacts/research'
import { isWorking, type Artifact } from '@/domain/artifacts/types'

/**
 * Research the model did on the web: searches, and the pages it read.
 *
 * The result rows are the artifact — everything else is context for them —
 * so they get the space and the shell's summary line stays out of the way.
 * One search is its rows and nothing more. Several steps are a list: each
 * query (or page) a heading with its own dot, its sources beneath, so three
 * searches fired together read as three dots pulsing at once and settling
 * one at a time, and a page read after them stands under the searches that
 * found it. That is the order the model asked in, kept.
 *
 * ---- Five rows a query ------------------------------------------------------
 *
 * A search may answer with twenty hits, and three of them together would be
 * sixty rows of a reply that has not yet said anything. The first five of a
 * query stand; the rest are one line away, per query, and the count on the
 * heading tells the whole before it is opened.
 *
 * ---- The favicon question -------------------------------------------------
 *
 * Real favicons would mean a network request per result, to a third-party
 * domain, from a desktop app, on every render of a transcript. That is a
 * tracking surface and a source of layout shift for a 16px decoration. A
 * letter in a disc identifies the source just as well at this size and asks
 * nothing of anyone.
 */

const HITS_SHOWN = 5

export function WebResearchArtifact({ artifact }: { artifact: Artifact }) {
  const steps = researchOf(artifact)
  const working = isWorking(artifact.status)
  const timeline = artifact.sections?.find((section) => section.type === 'timeline')
  const searches = steps.filter((step): step is SearchStep => step.kind === 'search')
  const reads = steps.filter((step): step is ReadStep => step.kind === 'read')

  return (
    <ArtifactShell
      artifact={artifact}
      mark={searches.length > 0 ? <Icons.search /> : <Icons.browserUse />}
      status={statusOf(artifact, steps, searches, reads, working)}
    >
      {steps.length === 1 && steps[0] !== undefined ? (
        <StepBody step={steps[0]} />
      ) : (
        <AnimatedList className="gap-3">
          {steps.map((step, index) => (
            <AnimatedItem key={step.id} index={index}>
              <StepHeading step={step} />
              <StepBody step={step} indented />
            </AnimatedItem>
          ))}
        </AnimatedList>
      )}

      {timeline?.type === 'timeline' ? (
        <div className="mt-3">
          <Timeline items={timeline.items} />
        </div>
      ) : null}
    </ArtifactShell>
  )
}

function plural(count: number, noun: string): string {
  if (count === 1) return `1 ${noun}`
  const many = noun.endsWith('ch') ? `${noun}es` : noun.endsWith('y') ? `${noun.slice(0, -1)}ies` : `${noun}s`
  return `${String(count)} ${many}`
}

function statusOf(
  artifact: Artifact,
  steps: readonly ResearchStep[],
  searches: readonly SearchStep[],
  reads: readonly ReadStep[],
  working: boolean,
): string {
  if (artifact.status === 'failed') {
    return steps.find((step) => step.error !== undefined)?.error ?? 'The search failed'
  }
  if (working) {
    const running = steps.filter((step) => step.status === 'running')
    if (running.length === 0) return 'Queued'
    const searching = running.some((step) => step.kind === 'search')
    const reading = running.some((step) => step.kind === 'read')
    if (searching && reading) return 'Searching and reading'
    if (reading) return running.length > 1 ? `Reading ${plural(running.length, 'page')}` : 'Reading'
    return running.length > 1 ? `Searching ${plural(running.length, 'query')}` : 'Searching'
  }
  const sources = searches.reduce((sum, step) => sum + step.hits.length, 0)
  if (steps.length === 1 && searches[0] !== undefined) {
    return `${plural(sources, 'source')} for “${searches[0].query}”`
  }
  if (steps.length === 1 && reads[0] !== undefined) {
    return reads[0].provider === undefined ? 'Read' : `Read by ${reads[0].provider}`
  }
  return [
    searches.length > 0 ? plural(searches.length, 'search') : null,
    reads.length > 0 ? `${plural(reads.length, 'page')} read` : null,
    searches.length > 0 ? plural(sources, 'source') : null,
  ]
    .filter(Boolean)
    .join(' · ')
}

/** The line a step stands under when it is one of several. */
function StepHeading({ step }: { step: ResearchStep }) {
  const running = isWorking(step.status)
  const label = step.kind === 'search' ? step.query : `Read ${step.title ?? hostOf(step.url)}`
  const trailing =
    step.status === 'failed'
      ? 'failed'
      : running
        ? null
        : step.kind === 'search'
          ? plural(step.hits.length, 'source')
          : hostOf(step.url)

  return (
    <div className="flex items-center gap-2.5 px-1.5">
      <StatusDot status={step.status} />
      <span className="min-w-0 flex-1 truncate text-ui text-foreground">
        {label}
      </span>
      {trailing !== null ? (
        <span
          className={cn(
            'shrink-0 text-caption',
            step.status === 'failed' ? 'text-danger' : 'text-muted-foreground',
          )}
        >
          {trailing}
        </span>
      ) : step.status === 'running' ? (
        <WorkingDots className="shrink-0 text-muted-foreground" />
      ) : null}
    </div>
  )
}

function StepBody({ step, indented = false }: { step: ResearchStep; indented?: boolean }) {
  // Under a heading the body keeps the heading's text column, so the dots
  // read as a margin and the rows as what each dot is about.
  const inset = indented ? 'pl-[22px]' : undefined
  if (step.status === 'failed') {
    // A step of several says its own failure; alone, the shell already has.
    return indented && step.error !== undefined ? (
      <p className={cn('mt-1 text-caption text-danger', inset)}>{step.error}</p>
    ) : null
  }
  return step.kind === 'search' ? (
    <SearchBody step={step} className={inset} />
  ) : (
    <ReadBody step={step} className={inset} />
  )
}

function SearchBody({ step, className }: { step: SearchStep; className?: string }) {
  const [open, setOpen] = useState(false)
  const shown = open ? step.hits : step.hits.slice(0, HITS_SHOWN)
  const hidden = step.hits.length - shown.length
  const done = step.status === 'done'

  return (
    <div className={cn('flex flex-col', className)}>
      {step.fellBack !== undefined ? (
        <p className="px-1.5 pb-1 text-caption text-muted-foreground">{step.fellBack}</p>
      ) : null}
      {step.summary !== undefined ? (
        <p className="px-1.5 pb-1.5 text-ui text-muted-foreground">{step.summary}</p>
      ) : null}
      {done && step.hits.length === 0 && className === undefined ? (
        <p className="px-1.5 text-caption text-muted-foreground">No results.</p>
      ) : null}
      <AnimatedList className="gap-0.5">
        {shown.map((hit, index) => (
          <AnimatedItem key={hit.url} index={index}>
            <Result hit={hit} />
          </AnimatedItem>
        ))}
      </AnimatedList>
      {hidden > 0 || (open && step.hits.length > HITS_SHOWN) ? (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="mt-0.5 self-start rounded-md px-1.5 py-1 text-caption text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
        >
          {open ? 'Show fewer' : `Show ${String(hidden)} more`}
        </button>
      ) : null}
    </div>
  )
}

function ReadBody({ step, className }: { step: ReadStep; className?: string }) {
  // Before the page has answered there is nothing to say about it that the
  // heading, or the shell, has not: the row appears with the words.
  if (step.status !== 'done') return null
  return (
    <div className={cn('flex flex-col', className)}>
      {step.fellBack !== undefined ? (
        <p className="px-1.5 pb-1 text-caption text-muted-foreground">{step.fellBack}</p>
      ) : null}
      <Result
        hit={{
          title: step.title ?? hostOf(step.url),
          url: step.url,
          ...(step.excerpt === undefined ? {} : { snippet: step.excerpt }),
        }}
        // Under its own heading the page's title is already on the line
        // above; the row keeps the address and the opening of the text.
        titled={className === undefined}
      />
    </div>
  )
}

function Result({ hit, titled = true }: { hit: ResearchHit; titled?: boolean }) {
  return (
    <a
      href={hit.url}
      target="_blank"
      rel="noreferrer noopener"
      className="group/result flex items-start gap-2.5 rounded-lg px-1.5 py-1.5 transition-colors duration-fast hover:bg-tint"
    >
      <Initial href={hit.url} />
      <span className="min-w-0 flex-1">
        {titled ? (
          <>
            <span className="block truncate text-ui text-foreground">{hit.title}</span>
            <span className="block truncate text-caption text-muted-foreground">{hostOf(hit.url)}</span>
          </>
        ) : null}
        {hit.snippet ? (
          <span className="mt-1 line-clamp-2 text-caption text-muted-foreground">{hit.snippet}</span>
        ) : null}
      </span>
      <span className="flex h-[1lh] shrink-0 items-center text-ui">
        <Icons.openExternal className="opacity-0 transition-opacity duration-fast group-hover/result:opacity-100" />
      </span>
    </a>
  )
}

function Initial({ href }: { href: string }) {
  const host = hostOf(href)
  return (
    // The outer box is one line of the result's title tall, so the disc
    // centres on that line instead of being nudged down toward it. The disc
    // keeps its own size on the inside — it is a shape, not a glyph, and it
    // should not resize with the line it happens to sit on.
    <span aria-hidden className="flex h-[1lh] shrink-0 items-center text-ui">
      <span className="flex size-5 items-center justify-center rounded-full bg-selected text-micro font-semibold text-muted-foreground">
        {host.charAt(0).toUpperCase()}
      </span>
    </span>
  )
}
