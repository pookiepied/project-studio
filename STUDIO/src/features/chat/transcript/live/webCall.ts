import type { ToolCallView } from '@/features/chat/transcript/projection'
import type { ReadStep, ResearchHit, ResearchStep, SearchStep } from '@/domain/artifacts/research'
import type { Artifact, ArtifactStatus } from '@/domain/artifacts/types'
import { hostOf } from '@/lib/url'
import { answerText, inputString } from './callText'

/**
 * Reading the web calls - `web_search`, `fetch` - out of the transcript's
 * tool calls, and writing a segment's worth of them as one artifact.
 *
 * The harness answers both tools in prose of a fixed shape
 * (`STUDIO HARNESS/src/tools/web/search.ts` and `fetch.ts` state it): a
 * search is "Searched with X.", the note that the text is information, an
 * optional provider summary, then numbered hits of title, address and
 * snippet; a read is the page's title as a heading, `Source:` and `Read
 * by:` lines, the same note, and the page's text. The shapes are parsed
 * here, not guessed at from the sentences around them.
 *
 * ---- One artifact for the segment ------------------------------------------
 *
 * The model researches in bursts: three searches fired together, then a
 * read of the two results worth reading. Drawn as five disclosure rows
 * that is a log; drawn as one artifact with a step per call it is what
 * happened - three dots pulsing at once, settling one by one as each
 * answer lands, and the pages read beneath them.
 */

const WEB_TOOL = /^(?:native_)?(web_search|fetch)$/

const SEARCHED_WITH = /^Searched with (.+)\.$/m
const NO_RESULTS = /^No results for "(.*)" \(searched with (.+)\)\.$/m
const FELL_BACK = /^(.+ could not (?:answer|read it) \(.+\), so .+ was used\.)$/m
const PROVIDER_SUMMARY = /^Provider summary: (.+)$/m
const HIT_HEAD = /^(\d+)\. (.+)$/
const READ_BY = /^Read by: (.+)$/m
const SOURCE = /^Source: (.+)$/m
const HEADING = /^# (.+)$/m

/** How much of a read page the artifact shows. */
const EXCERPT_LENGTH = 280

/** `search` or `read` for one of ours, else null. */
export function webKind(toolName: string): 'search' | 'read' | null {
  const match = WEB_TOOL.exec(toolName)
  return match?.[1] === 'web_search' ? 'search' : match?.[1] === 'fetch' ? 'read' : null
}

/** The numbered hits of a search answer, in order. */
export function hitsIn(text: string): readonly ResearchHit[] {
  const lines = text.split('\n')
  const hits: ResearchHit[] = []
  let index = 0
  while (index < lines.length) {
    const head = HIT_HEAD.exec(lines[index] ?? '')
    const url = lines[index + 1]?.trim()
    if (head?.[2] === undefined || url === undefined || !/^https?:\/\//i.test(url)) {
      index += 1
      continue
    }
    // The snippet is every line up to the next blank or the next hit.
    const snippet: string[] = []
    let cursor = index + 2
    while (cursor < lines.length) {
      const line = lines[cursor] ?? ''
      if (line.trim() === '' || HIT_HEAD.test(line)) break
      snippet.push(line.trim())
      cursor += 1
    }
    const joined = snippet.join(' ')
    hits.push({ title: head[2].trim(), url, ...(joined === '' ? {} : { snippet: joined }) })
    index = cursor
  }
  return hits
}

function stepStatus(call: ToolCallView): ArtifactStatus {
  if (call.errorText !== null) return 'failed'
  return call.output !== null && call.output.present ? 'done' : 'running'
}

function searchStep(call: ToolCallView): SearchStep {
  const answered = call.output?.present ? answerText(call.output.value) : ''
  const none = NO_RESULTS.exec(answered)
  const provider = SEARCHED_WITH.exec(answered)?.[1] ?? none?.[2]
  const fellBack = FELL_BACK.exec(answered)?.[1]
  const summary = PROVIDER_SUMMARY.exec(answered)?.[1]
  return {
    kind: 'search',
    id: call.toolCallId,
    status: stepStatus(call),
    query: inputString(call.input?.present ? call.input.value : null, 'query') ?? none?.[1] ?? '',
    hits: hitsIn(answered),
    ...(provider === undefined ? {} : { provider }),
    ...(fellBack === undefined ? {} : { fellBack }),
    ...(summary === undefined ? {} : { summary }),
    ...(call.errorText === null ? {} : { error: call.errorText }),
  }
}

/** The opening of the page: everything after the header's blank line, flattened. */
function excerptOf(answered: string): string | undefined {
  const start = answered.indexOf('\n\n')
  if (start === -1) return undefined
  const body = answered
    .slice(start + 2)
    .replace(/^#+\s*/gm, '')
    .replace(/[*_`>]+/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  if (body === '') return undefined
  return body.length > EXCERPT_LENGTH ? `${body.slice(0, EXCERPT_LENGTH).trimEnd()}…` : body
}

function readStep(call: ToolCallView): ReadStep {
  const answered = call.output?.present ? answerText(call.output.value) : ''
  const url = inputString(call.input?.present ? call.input.value : null, 'url') ?? SOURCE.exec(answered)?.[1] ?? ''
  const title = HEADING.exec(answered)?.[1]
  const provider = READ_BY.exec(answered)?.[1]
  const fellBack = FELL_BACK.exec(answered)?.[1]
  const excerpt = call.output?.present ? excerptOf(answered) : undefined
  return {
    kind: 'read',
    id: call.toolCallId,
    status: stepStatus(call),
    url,
    ...(title === undefined ? {} : { title }),
    ...(provider === undefined ? {} : { provider }),
    ...(fellBack === undefined ? {} : { fellBack }),
    ...(excerpt === undefined ? {} : { excerpt }),
    ...(call.errorText === null ? {} : { error: call.errorText }),
  }
}

export function readWebCall(call: ToolCallView): ResearchStep | null {
  const kind = webKind(call.toolName)
  if (kind === null) return null
  return kind === 'search' ? searchStep(call) : readStep(call)
}

/**
 * The artifact for a segment's web calls: every call a step, the first
 * query the title, the whole's state the state of its parts. Working while
 * any step is; failed only when every step is; done otherwise.
 */
export function researchArtifact(calls: readonly ToolCallView[]): Artifact {
  const steps = calls.flatMap((call) => {
    const step = readWebCall(call)
    return step === null ? [] : [step]
  })
  const first = steps[0]
  // One step is titled by what it is. Several are titled by the first and
  // say how many follow - the headings beneath name each in full, so the
  // title saying the first one twice would be the card repeating itself.
  const lead =
    first === undefined
      ? 'Research'
      : first.kind === 'search'
        ? first.query
        : first.title ?? hostOf(first.url)
  const title = steps.length > 1 ? `${lead} and ${String(steps.length - 1)} more` : lead

  const status: ArtifactStatus = steps.some((step) => step.status === 'running')
    ? 'running'
    : steps.length > 0 && steps.every((step) => step.status === 'failed')
      ? 'failed'
      : 'done'

  const servers = new Set(steps.flatMap((step) => (step.provider === undefined ? [] : [step.provider])))
  const server = servers.size === 1 ? [...servers][0] : undefined

  return {
    kind: 'web_research',
    id: `research:${first?.id ?? 'none'}`,
    title,
    status,
    ...(server === undefined ? {} : { source: { server } }),
    data: { steps },
  }
}

