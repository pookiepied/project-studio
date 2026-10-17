/**
 * Reading a computer-use call out of the log, so the transcript can show a
 * report of the screen rather than a wall of JSON.
 *
 * ADR 0055 §7: the person sees what the model sees. Every acting call brings
 * back a frame of the display it acted on, and the report puts the newest one
 * where a reader looks first, so "what is it doing to my computer" is
 * answered by looking rather than by opening rows. The browser's report is the
 * pattern (ADR 0049 §7), and this reads the computer's calls into the same
 * shape - one vocabulary, two capabilities - which is why the types here are
 * the browser's own.
 *
 * Read defensively out of `unknown`, as `browserCall` is: a card that throws
 * on an unexpected shape takes the transcript down with it.
 */

import { isRecord } from '@/lib/guards'
import type { BrowserStep } from '@/domain/browser/steps'
import { frameOf, textOf, type BrowserCallView } from './browserCall'

/** The name the model calls, which encodes the server id and the tool name. */
const COMPUTER_TOOL = /studio_computer_([a-z_]+)$/

/** The bare action, or null when this is not one of ours. */
export function computerAction(toolName: string): string | null {
  return COMPUTER_TOOL.exec(toolName)?.[1] ?? null
}

/**
 * The verb, in the two tenses a row needs. Written out rather than derived,
 * for the browser's reason: "read_ui" tensed by rule is "Read_uiing".
 */
const VERBS: Readonly<Record<string, readonly [string, string]>> = {
  displays: ['Listing displays', 'Listed displays'],
  screenshot: ['Looking at the screen', 'Looked at the screen'],
  zoom: ['Looking closer', 'Looked closer'],
  cursor: ['Finding the pointer', 'Found the pointer'],
  move: ['Moving the pointer', 'Moved the pointer'],
  click: ['Clicking', 'Clicked'],
  drag: ['Dragging', 'Dragged'],
  mouse_button: ['Holding the button', 'Held the button'],
  scroll: ['Scrolling', 'Scrolled'],
  type: ['Typing', 'Typed'],
  key: ['Pressing', 'Pressed'],
  hold_key: ['Holding a key', 'Held a key'],
  apps: ['Listing apps', 'Listed apps'],
  windows: ['Listing windows', 'Listed windows'],
  open: ['Opening', 'Opened'],
  focus: ['Bringing a window forward', 'Brought a window forward'],
  read_ui: ['Reading the window', 'Read the window'],
  act: ['Pressing a control', 'Pressed a control'],
  set_value: ['Setting a value', 'Set a value'],
  select_text: ['Selecting text', 'Selected text'],
  clipboard: ['Using the clipboard', 'Used the clipboard'],
  wait: ['Waiting', 'Waited'],
  stop: ['Stopping computer control', 'Stopped computer control'],
}

export function computerVerb(action: string, running: boolean): string {
  const pair = VERBS[action]
  if (pair === undefined) return action.replace(/_/g, ' ')
  return running ? pair[0] : pair[1]
}

/**
 * The window a call named, read back off its words.
 *
 * The server writes `"Title" (window 1234)` wherever a call lands in a window
 * - open, focus, read_ui - precisely so a model never acts on "the window in
 * front". The report reads the same phrase and shows the title as the place,
 * the way the browser's report shows a URL.
 */
function windowOf(body: string): string | null {
  const match = /"([^"\n]+)" \(window \d+\)/.exec(body)
  return match?.[1] ?? null
}

export function readComputerCall(
  toolName: string,
  output: unknown,
  errorText: string | null,
): BrowserCallView | null {
  const action = computerAction(toolName)
  if (action === null) return null
  const body = textOf(output)
  const said = body.trim()
  return {
    action,
    url: null,
    title: windowOf(body),
    tab: null,
    frame: errorText === null ? frameOf(output) : null,
    said: said === '' ? null : said,
  }
}

/**
 * What the row says the call is about, before any answer has come back.
 * Read from the input, because a running call has no output yet.
 */
export function computerSubject(action: string, input: unknown): string | null {
  if (!isRecord(input)) return null
  const first = (...keys: readonly string[]): string | null => {
    for (const key of keys) {
      const value = input[key]
      if (typeof value === 'string' && value !== '') return value
      if (typeof value === 'number') return String(value)
    }
    return null
  }
  if (action === 'open') return first('app', 'path')
  if (action === 'type') return first('text')
  if (action === 'key' || action === 'hold_key') return first('keys')
  if (action === 'click' || action === 'move' || action === 'scroll') {
    const x = input['x']
    const y = input['y']
    return typeof x === 'number' && typeof y === 'number' ? `${String(x)},${String(y)}` : null
  }
  if (action === 'focus' || action === 'read_ui') {
    const window = first('window')
    return window === null ? null : `window ${window}`
  }
  if (action === 'clipboard') return first('action')
  if (action === 'wait') {
    const seconds = first('seconds')
    return seconds === null ? null : `${seconds}s`
  }
  return first('ref', 'app')
}

/** One answered call, as a step - the same mapping the browser's steps use. */
export function computerStepOf(call: {
  readonly toolCallId: string
  readonly toolName: string
  readonly input: { readonly present: boolean; readonly value: unknown } | null
  readonly output: { readonly present: boolean; readonly value: unknown } | null
  readonly errorText: string | null
}): BrowserStep | null {
  const action = computerAction(call.toolName)
  if (action === null) return null
  const answered = call.output !== null && call.output.present
  const view = answered ? readComputerCall(call.toolName, call.output.value, call.errorText) : null
  return {
    id: call.toolCallId,
    action,
    verb: computerVerb(action, !answered && call.errorText === null),
    subject: computerSubject(action, call.input?.present === true ? call.input.value : null),
    url: null,
    title: view?.title ?? null,
    failed: call.errorText !== null,
    frame: view?.frame ?? null,
    settled: answered || call.errorText !== null,
  }
}
