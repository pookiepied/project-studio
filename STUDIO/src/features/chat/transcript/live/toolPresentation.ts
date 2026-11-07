import { familyOf } from './reportFamily'
import { mediaKind } from './mediaCall'
import { webKind } from './webCall'

/** Placement is independent of execution grouping and of the assistant's answer. */
export interface ToolPresentation {
  /** The representation inside the activity disclosure; none leaves no row. */
  readonly activity: 'row' | 'steps' | 'compact-research' | 'none'
  /** A standalone result rendered from invocation onward, including failures. */
  readonly artifact: 'media' | 'answers' | null
  /** A recorded result surfaced after completion, when the output proves one. */
  readonly result: 'browser' | 'computer' | 'changes' | 'background' | null
}

const DEFAULT: ToolPresentation = { activity: 'row', artifact: null, result: null }

// Keep placement declarative so a new capability does not acquire a second
// renderer in the activity list and the completion results independently.
// Reuse the capability's tool-name adapter below, including its aliases. Unknown
// tools keep an inspectable row without claiming an artifact or a final result.
export const TOOL_PRESENTATIONS = {
  browser: { activity: 'steps', artifact: null, result: 'browser' },
  computer: { activity: 'steps', artifact: null, result: 'computer' },
  media: { activity: 'none', artifact: 'media', result: null },
  research: { activity: 'compact-research', artifact: null, result: null },
  // What the person answered is theirs, not the agent's working-out, so it
  // stands in the transcript rather than inside the activity block.
  question: { activity: 'none', artifact: 'answers', result: null },
  changes: { activity: 'row', artifact: null, result: 'changes' },
  background: { activity: 'row', artifact: null, result: 'background' },
} satisfies Record<string, ToolPresentation>

export function toolPresentation(toolName: string): ToolPresentation {
  const family = familyOf(toolName)
  if (family !== null) return TOOL_PRESENTATIONS[family.id]
  if (mediaKind(toolName) !== null) return TOOL_PRESENTATIONS.media
  if (webKind(toolName) !== null) return TOOL_PRESENTATIONS.research
  if (toolName === 'ask_user_question') return TOOL_PRESENTATIONS.question
  if (['write', 'edit', 'move', 'delete'].includes(toolName)) return TOOL_PRESENTATIONS.changes
  if (toolName === 'shell') return TOOL_PRESENTATIONS.background
  return DEFAULT
}
