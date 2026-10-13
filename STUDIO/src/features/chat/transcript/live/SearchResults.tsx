import { FileTypeMark, splitFilePath } from '@/components/icons/fileTypes'
import { cn } from '@/lib/cn'

import {
  highlightSpans,
  type SearchBody,
  type SearchContentFile,
  type SearchOutcome,
  type SearchQuery,
} from './searchOutcome'

/**
 * A search's working-out, expanded: a summary line, then the answer as a
 * list in the shape its mode names.
 *
 * Deliberately not a card, and deliberately not behind the row's rule. The
 * framed code panel is the file tools' shape, and the ruled indent reads as
 * an outliner -- both make a finding look like chrome around it rather than
 * an answer to scan. The established shape for search answers, from
 * ripgrep's own `path:line: text` to Claude Code's file-grouped lists, is a
 * summary with the hits under it: files with their matches, each match on
 * its real line number, the matched words marked. So the list stands flush
 * at the content boundary and says whose it is the quiet way: one nesting
 * step of alignment, the summary echoing the chip's pattern beside its
 * count, hairlines between file groups and nowhere else. Code type appears
 * only where code is quoted. Context lines stand muted beside the hits they
 * surround, counted nowhere.
 *
 * The list is not capped: the harness pages the answer, and the page on
 * screen is the answer. Long lines scroll sideways inside the body rather
 * than pushing the column wide.
 */
export function SearchResults({ outcome }: { outcome: SearchOutcome }) {
  // Destructured once: narrowing on the `outcome.body` path would not survive
  // the element calls below it, so the branches read the local instead.
  const { query, body, note } = outcome
  if (body.kind === 'none') {
    return (
      <p className="studio-selectable pl-5 text-caption text-muted-foreground">{body.sentence}</p>
    )
  }
  return (
    // One nesting step, not the row's rule: alignment says "this belongs to
    // the chip above" without drawing an edge that says "outliner".
    <div className="flex min-w-0 flex-col gap-1.5 pl-5 text-ui">
      <div className="flex min-w-0 items-baseline gap-2">
        <QueryWords query={query} />
        <span className="ml-auto shrink-0 tabular-nums text-caption text-muted-foreground">
          <SummaryStat body={body} />
        </span>
      </div>
      {/* The sideways scroller: a 400-character hit is still one row in a
          reading column. The track runs at its content width, as the diff
          card's does, so short results sit naturally and long ones scroll
          instead of growing the button's row past the window. */}
      <div className="studio-scroll-frame min-w-0 overflow-x-auto">
        <div className="w-max min-w-full font-mono text-code">
          {body.kind === 'content' ? (
            // Hairlines between file groups, nowhere else: siblings divide,
            // the list itself draws no edge.
            <div className="flex flex-col divide-y divide-hairline">
              {body.files.map((file) => (
                <ContentFileView key={file.path} file={file} query={query} />
              ))}
            </div>
          ) : body.kind === 'files' ? (
            body.paths.map((path) => <PathRow key={path} path={path} />)
          ) : (
            body.rows.map((row) => <CountRow key={row.path} path={row.path} count={row.count} />)
          )}
        </div>
      </div>
      {note !== null ? (
        <p className="text-caption text-muted-foreground">{note}</p>
      ) : null}
    </div>
  )
}

/**
 * The call's aim while its answer has not arrived: the pattern, the scope,
 * the filters -- everything the summary will say except the count, which is
 * not known yet. A running search used to show its raw input behind an `in:`
 * label; the aim is what that slab was trying to say.
 */
export function SearchQueryLine({ query }: { query: SearchQuery }) {
  return (
    <div className="studio-selectable pl-5 text-caption">
      <QueryWords query={query} />
    </div>
  )
}

/** The pattern the model looked for, then where and how, in muted words. */
function QueryWords({ query }: { query: SearchQuery }) {
  return (
    <span className="min-w-0 truncate" title={queryTitle(query)}>
      <span className="font-mono text-ui text-foreground">{query.pattern}</span>
      {query.scope !== null ? (
        <span className="text-muted-foreground"> in {query.scope}</span>
      ) : null}
      {query.filters.map((filter) => (
        <span key={filter} className="text-muted-foreground">
          {' '}
          · {filter}
        </span>
      ))}
    </span>
  )
}

function queryTitle(query: SearchQuery): string {
  const words = [query.pattern]
  if (query.scope !== null) words.push(`in ${query.scope}`)
  words.push(...query.filters)
  return words.join(' ')
}

/** The summary's count: what is on the list, in the list's own numbers. */
function SummaryStat({ body }: { body: Exclude<SearchBody, { readonly kind: 'none' }> }) {
  if (body.kind === 'content') {
    return (
      <>
        {body.matches} {body.matches === 1 ? 'match' : 'matches'} · {body.files.length}{' '}
        {body.files.length === 1 ? 'file' : 'files'}
      </>
    )
  }
  if (body.kind === 'files') {
    return (
      <>
        {body.paths.length} {body.paths.length === 1 ? 'file' : 'files'}
      </>
    )
  }
  return (
    <>
      {body.total} {body.total === 1 ? 'match' : 'matches'} · {body.rows.length}{' '}
      {body.rows.length === 1 ? 'file' : 'files'}
    </>
  )
}

function ContentFileView({ file, query }: { file: SearchContentFile; query: SearchQuery }) {
  const { name, dir } = splitFilePath(file.path)
  return (
    <div className="py-1">
      <div className="flex items-baseline gap-1.5">
        <FileTypeMark path={file.path} className="shrink-0 self-center text-muted-foreground" />
        <span className="truncate text-ui" title={file.path}>
          {dir !== null ? <span className="text-muted-foreground">{dir}/</span> : null}
          <span className="font-medium text-foreground">{name}</span>
        </span>
        <span className="ml-auto shrink-0 pl-4 tabular-nums text-caption text-muted-foreground">
          {file.matches} {file.matches === 1 ? 'match' : 'matches'}
        </span>
      </div>
      {file.lines.map((line, index) => (
        <MatchLineView key={index} line={line.line} text={line.text} hit={line.hit} query={query} />
      ))}
    </div>
  )
}

function MatchLineView({
  line,
  text,
  hit,
  query,
}: {
  line: number
  text: string
  hit: boolean
  query: SearchQuery
}) {
  const spans = hit ? highlightSpans(text, query) : null
  return (
    <div className="grid grid-cols-[3.5rem_1fr] items-baseline">
      <span className="select-none pr-2 text-right text-caption tabular-nums text-muted-foreground">
        {line}
      </span>
      <code
        className={cn(
          'studio-selectable whitespace-pre pr-2',
          !hit && 'text-muted-foreground',
        )}
      >
        {/* A wholly empty line collapses without a character to carry the
            row's height, so it draws a space instead. */}
        {text === '' ? ' ' : spans === null ? text : <Highlighted spans={spans} />}
      </code>
    </div>
  )
}

/** The matched words, marked with the selection wash -- not the diff's colours, which would call a hit a change. */
function Highlighted({
  spans,
}: {
  spans: readonly { readonly text: string; readonly hit: boolean }[]
}) {
  return (
    <>
      {spans.map((span, index) =>
        span.hit ? (
          <span key={index} className="rounded-[4px] bg-selected px-px">
            {span.text}
          </span>
        ) : (
          <span key={index}>{span.text}</span>
        ),
      )}
    </>
  )
}

/** One path of a file list: the language's mark, the name, the way to it. */
function PathRow({ path }: { path: string }) {
  const { name, dir } = splitFilePath(path)
  return (
    <div className="flex items-baseline gap-1.5 py-px">
      <FileTypeMark path={path} className="shrink-0 self-center text-muted-foreground" />
      <span className="studio-selectable truncate" title={path}>
        {dir !== null ? <span className="text-muted-foreground">{dir}/</span> : null}
        <span className="text-foreground">{name}</span>
      </span>
    </div>
  )
}

function CountRow({ path, count }: { path: string; count: number }) {
  const { name, dir } = splitFilePath(path)
  return (
    <div className="flex items-baseline gap-1.5 py-px">
      <FileTypeMark path={path} className="shrink-0 self-center text-muted-foreground" />
      <span className="studio-selectable truncate" title={path}>
        {dir !== null ? <span className="text-muted-foreground">{dir}/</span> : null}
        <span className="text-foreground">{name}</span>
      </span>
      <span className="ml-auto shrink-0 pl-4 tabular-nums text-muted-foreground">{count}</span>
    </div>
  )
}
