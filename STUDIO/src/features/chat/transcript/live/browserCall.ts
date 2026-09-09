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

/** The name the model calls, which encodes the server id and the tool name. */
const BROWSER_TOOL = /studio_browser_([a-z_]+)/

export interface BrowserFrame {
  readonly data: string
  readonly mimeType: string
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
    if (block['type'] !== 'image') continue
    const data = block['data']
    const mimeType = block['mimeType']
    if (typeof data === 'string' && typeof mimeType === 'string' && data !== '') {
      return { data, mimeType }
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
