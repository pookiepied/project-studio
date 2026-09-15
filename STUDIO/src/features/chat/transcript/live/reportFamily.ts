import { Icons } from '@/components/icons'
import type { BrowserStep } from '@/domain/browser/steps'
import type { ToolCallView } from '@/features/chat/transcript/projection'
import { browserAction, browserStepOf, readBrowserCall, type BrowserCallView } from './browserCall'
import { computerAction, computerStepOf, readComputerCall } from './computerCall'

/**
 * The two capabilities that report as a picture and a sequence of steps.
 *
 * The browser (ADR 0049 §7) and the computer (ADR 0055 §7) both answer an
 * acting call with a frame, and a person watching either wants the same
 * three things: what it looks like now, what was just done, and the story
 * so far. One report renders both; what differs is named here - the words,
 * the mark, and how a call is read - so the report, the rail's panel and the
 * preview hook never branch on a tool name themselves.
 */
export type ReportFamilyId = 'browser' | 'computer'

export interface ReportFamily {
  readonly id: ReportFamilyId
  /** The word on the box and the tab: "Browser", "Computer". */
  readonly label: string
  readonly Mark: (typeof Icons)['browserUse']
  /** The bare action, or null when a tool name is not this family's. */
  readonly action: (toolName: string) => string | null
  readonly stepOf: (call: ToolCallView) => BrowserStep | null
  readonly read: (toolName: string, output: unknown, errorText: string | null) => BrowserCallView | null
  /** What a frame is a picture of, for its alt text and its absence. */
  readonly pictureOf: string
  /** The header line when no place has been named yet. */
  readonly nowhere: string
}

export const BROWSER_FAMILY: ReportFamily = {
  id: 'browser',
  label: 'Browser',
  Mark: Icons.browserUse,
  action: browserAction,
  stepOf: browserStepOf,
  read: readBrowserCall,
  pictureOf: 'the page as the browser saw it',
  nowhere: 'No page open',
}

export const COMPUTER_FAMILY: ReportFamily = {
  id: 'computer',
  label: 'Computer',
  Mark: Icons.computerUse,
  action: computerAction,
  stepOf: computerStepOf,
  read: readComputerCall,
  pictureOf: 'the screen as Studio saw it',
  nowhere: 'The screen',
}

export const REPORT_FAMILIES: readonly ReportFamily[] = [BROWSER_FAMILY, COMPUTER_FAMILY]

/** The family a tool name belongs to, or null for every other tool. */
export function familyOf(toolName: string): ReportFamily | null {
  return REPORT_FAMILIES.find((family) => family.action(toolName) !== null) ?? null
}

export function familyById(id: ReportFamilyId): ReportFamily {
  return id === 'browser' ? BROWSER_FAMILY : COMPUTER_FAMILY
}
