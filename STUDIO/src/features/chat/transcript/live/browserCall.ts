/**
 * Reading a browser tool call out of the log, so the transcript can show a
 * report of a browser rather than a wall of JSON.
 *
 * ADR 0049 §7 decides what this is for: what a person sees is *not* a browser.
 * There is no address bar, no back button, nothing to browse by hand. It is a
 * report — where the page is, what was just done to it, and what it looked
 * like a moment later — which is the whole difference between "it feels like
 * magic happening" and "here is a power-user panel nobody asked for".
 *
 * Everything here is read defensively out of `unknown`. The output is whatever
 * the harness forwarded from the browser server, and a card that throws on an
 * unexpected shape would take the whole transcript down with it. Anything this
 * file cannot read simply is not shown, and the ordinary tool row draws it
 * instead.
 */

import { isAttachmentReference } from '@/platform/harness'

/** The name the model calls, which encodes the server id and the tool name. */
const BROWSER_TOOL = /studio_browser_([a-z_]+)/

/**
 * A frame, in the two forms the transcript can carry it.
 *
 * The persistence layer stores every tool-result image in the attachment
 * store and leaves the transcript holding a reference (`att_...`), so a frame
 * read out of a call is usually that reference and must be fetched before it
 * can be shown. An inline frame - real base64 in the block itself - still
 * exists wherever the result was never persisted through the store, and is
 * renderable as it stands.
 */
export type BrowserFrame =
  | { readonly kind: 'inline'; readonly data: string; readonly mimeType: string }
  | { readonly kind: 'attachment'; readonly id: string; readonly mimeType: string }

/**
 * One answered browser call, as the rail's step list carries it.
 *
 * Everything here is a fact the call itself reported: the verb tensed by its
 * own outcome, the subject it acted on, the place it landed, whether it
 * failed, and the frame it brought back (a reference, most of the time). The
 * rail's "What happened" is a list of these, and the transcript's report row
 * is the same list - one vocabulary, two sizes.
 */
export interface BrowserStep {
  /** The tool call's own id, which keys the step in a list. */
  readonly id: string
  /** The bare action: `open`, `click`, `read_text`. */
  readonly action: string
  /** The verb in the past tense; an answered call has happened. */
  readonly verb: string
  /** What the call acted on, read from its input. */
  readonly subject: string | null
  /** Where the page was when the call answered. */
  readonly url: string | null
  /** The page's own name for itself, when the call reported one. */
  readonly title: string | null
  readonly failed: boolean
  readonly frame: BrowserFrame | null
  /**
   * Whether this call is over, either way.
   *
   * Read by the rail to decide whether its report changed, and it has to be
   * stated rather than inferred from the other fields. The obvious inference -
   * "it has a frame or it failed" - is wrong for the eight tools that only
   * read: `read_text`, `console`, `tabs` and the rest answer with words and no
   * picture, so a call of theirs going from running to answered changes none
   * of the fields a signature could otherwise notice. The rail would keep
   * showing "reading the page" after the page had been read.
   */
  readonly settled: boolean
}

export interface BrowserCallView {
  /** The bare action: `open`, `click`, `read_text`. */
  readonly action: string
  /** Where the page was when the call answered. */
  readonly url: string | null
  readonly title: string | null
  readonly tab: string | null
  /** The picture the acting call returned, when there was one. */
  readonly frame: BrowserFrame | null
  /** What the tool said it did, without the two lines of place beneath it. */
  readonly said: string | null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** The bare action, or null when this is not one of ours. */
export function browserAction(toolName: string): string | null {
  return BROWSER_TOOL.exec(toolName)?.[1] ?? null
}

/**
 * The verb, in the two tenses a row needs.
 *
 * Written out rather than derived from the action, because "read_text" tensed
 * by rule reads as "Read_texting". The list is short and the words are the
 * ones a person would use for what actually happened.
 */
const VERBS: Readonly<Record<string, readonly [string, string]>> = {
  open: ['Opening', 'Opened'],
  navigate: ['Navigating', 'Navigated'],
  read_text: ['Reading', 'Read'],
  read_page: ['Reading', 'Read'],
  read_links: ['Reading links', 'Read links'],
  find: ['Looking for', 'Found'],
  screenshot: ['Taking a picture', 'Took a picture'],
  click: ['Clicking', 'Clicked'],
  type: ['Typing', 'Typed'],
  press: ['Pressing', 'Pressed'],
  select: ['Choosing', 'Chose'],
  hover: ['Hovering', 'Hovered'],
  scroll: ['Scrolling', 'Scrolled'],
  drag: ['Dragging', 'Dragged'],
  upload: ['Attaching', 'Attached'],
  dialog: ['Answering a dialog', 'Answered a dialog'],
  wait_for: ['Waiting', 'Waited'],
  console: ['Checking the console', 'Checked the console'],
  network: ['Checking the network', 'Checked the network'],
  evaluate: ['Evaluating', 'Evaluated'],
  viewport: ['Resizing', 'Resized'],
  tabs: ['Listing tabs', 'Listed tabs'],
  close_tab: ['Closing a tab', 'Closed a tab'],
  quit: ['Closing the browser', 'Closed the browser'],
}

export function browserVerb(action: string, running: boolean): string {
  const pair = VERBS[action]
  if (pair === undefined) return action.replace(/_/g, ' ')
  return running ? pair[0] : pair[1]
}

/**
 * Every content block in whatever the harness forwarded.
 *
 * The result may be the MCP shape (`{ content: [...] }`), or a bare array, or
 * something wrapped once more by the time it reaches here. All three are
 * walked rather than assumed, because the alternative is a card that works
 * until the day the wire gains a field.
 */
function blocks(output: unknown): readonly unknown[] {
  if (Array.isArray(output)) return output
  if (!isRecord(output)) return []
  const content = output['content']
  if (Array.isArray(content)) return content
  const inner = output['value'] ?? output['result']
  return inner === undefined ? [] : blocks(inner)
}

function textOf(output: unknown): string {
  return blocks(output)
    .filter((block): block is Record<string, unknown> => isRecord(block))
    .filter((block) => block['type'] === 'text' && typeof block['text'] === 'string')
    .map((block) => block['text'] as string)
    .join('\n')
}

function frameOf(output: unknown): BrowserFrame | null {
  for (const block of blocks(output)) {
    if (!isRecord(block)) continue
    // The two spellings persistence can leave behind. A live chunk carries
    // the raw attachment block (`type: "attachment"` with the reference
    // nested); a history snapshot's projection maps the same block to an
    // image whose data is the attachment's id. Both are the same fact - the
    // bytes live in the store, the transcript holds the address - and either
    // may be answered by fetching the id.
    if (block['type'] === 'attachment') {
      const reference = block['attachment']
      if (!isRecord(reference)) continue
      const id = reference['id']
      const mimeType = reference['mimeType']
      if (typeof id === 'string' && typeof mimeType === 'string' && id !== '') {
        return { kind: 'attachment', id, mimeType }
      }
      continue
    }
    if (block['type'] !== 'image') continue
    const data = block['data']
    const mimeType = block['mimeType']
    if (typeof data === 'string' && typeof mimeType === 'string' && data !== '') {
      if (isAttachmentReference(data)) {
        return { kind: 'attachment', id: data, mimeType }
      }
      return { kind: 'inline', data, mimeType }
    }
  }
  return null
}

/**
 * The three lines every result carries, pulled back apart.
 *
 * The server writes them as `Tab:`, `URL:` and `Title:` on their own lines
 * (see the harness's `browser/result.ts`) precisely so a model that clicked
 * knows where it landed. The card reads the same lines and shows them as a
 * place instead of as prose, and strips them from the sentence so the same
 * fact is not printed twice.
 */
export function readBrowserCall(
  toolName: string,
  output: unknown,
  errorText: string | null,
): BrowserCallView | null {
  const action = browserAction(toolName)
  if (action === null) return null

  const body = textOf(output)
  const line = (label: string): string | null =>
    new RegExp(`^${label}:\\s*(.*)$`, 'm').exec(body)?.[1]?.trim() ?? null

  const url = line('URL')
  const said = body
    .split('\n')
    .filter((row) => !/^(Tab|URL|Title):/.test(row))
    .join('\n')
    .trim()

  return {
    action,
    url: url === '' ? null : url,
    title: line('Title'),
    tab: line('Tab'),
    frame: errorText === null ? frameOf(output) : null,
    said: said === '' ? null : said,
  }
}

/**
 * What the row says the call was about, before any answer has come back.
 *
 * Read from the input, because a running call has no output yet and a row
 * that says only "Opening" while a page loads is a row that has withheld the
 * one fact the reader wants.
 */
export function browserSubject(action: string, input: unknown): string | null {
  if (!isRecord(input)) return null
  const first = (...keys: readonly string[]): string | null => {
    for (const key of keys) {
      const value = input[key]
      if (typeof value === 'string' && value !== '') return value
    }
    return null
  }
  if (action === 'open' || action === 'navigate') return first('url', 'direction')
  if (action === 'find') return first('query')
  if (action === 'type') return first('text')
  if (action === 'press') return first('key')
  if (action === 'viewport') return first('preset', 'colorScheme')
  if (action === 'wait_for') return first('text', 'gone', 'selector', 'state')
  if (action === 'evaluate') return first('expression')
  return first('ref', 'selector')
}

/**
 * One answered call, as a step.
 *
 * This is the mapping the rail's step list and the transcript's report row
 * both render from, which is why it lives beside the reading rather than in
 * either renderer: two renderings of one mapping cannot disagree about what
 * a step is. `null` for a call that is not one of ours - the collector that
 * walks the transcript filters those before it gets here.
 */
export function browserStepOf(call: {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: { readonly present: boolean; readonly value: unknown } | null
  readonly output: { readonly present: boolean; readonly value: unknown } | null
  readonly errorText: string | null
}): BrowserStep | null {
  const action = browserAction(call.toolName)
  if (action === null) return null
  const answered = call.output !== null && call.output.present
  const view = answered
    ? readBrowserCall(call.toolName, call.output.value, call.errorText)
    : null
  return {
    id: call.toolCallId,
    action,
    verb: browserVerb(action, !answered && call.errorText === null),
    subject: browserSubject(action, call.input?.present === true ? call.input.value : null),
    url: view?.url ?? null,
    title: view?.title ?? null,
    failed: call.errorText !== null,
    frame: view?.frame ?? null,
    settled: answered || call.errorText !== null,
  }
}
