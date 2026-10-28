import { CodeBlock } from '../blocks'
import { Chart } from './Chart'
import { Cards, Progress, Stats, Timeline } from './Figures'
import { parseVisual } from './parse'

/**
 * The bridge from a visual fence to what it draws.
 *
 * Still arriving: a quiet white sheet in the place the visual will take, so
 * the transcript does not jump when it lands. Complete and unreadable: the
 * JSON itself, as code, with the reason above it -- what the model wrote is
 * never swallowed by a renderer that could not use it.
 */
export function VisualBlock({ fence, source, streaming }: { fence: string; source: string; streaming: boolean }) {
  const result = parseVisual(fence, source, streaming)
  if (result.kind === 'pending') {
    return <div aria-busy className="my-5 h-48 w-full rounded-2xl bg-surface-raised shadow-raised" />
  }
  if (result.kind === 'invalid') {
    return (
      <div>
        <p className="!mb-0 text-caption text-muted-foreground">This {fence} could not be drawn: {result.message}.</p>
        <CodeBlock code={source} fence="json" />
      </div>
    )
  }
  const { visual } = result
  switch (visual.kind) {
    case 'chart': return <Chart chart={visual} />
    case 'stats': return <Stats stats={visual} />
    case 'progress': return <Progress progress={visual} />
    case 'timeline': return <Timeline timeline={visual} />
    case 'cards': return <Cards cards={visual} />
  }
}
