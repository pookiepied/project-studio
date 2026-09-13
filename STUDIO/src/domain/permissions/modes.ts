/**
 * Execution modes.
 *
 * Three, and they escalate. The wording is the design here: each one is written
 * as the consequence to the user's machine, not as the mechanism. "Auto-approve
 * tool calls" describes our implementation; "writes files without asking"
 * describes what happens to their work, and that is what someone is choosing
 * between.
 *
 * These ids are this webview's own vocabulary. The harness names the same
 * three modes `manual` / `auto-edit` / `full-auto` - the one spelling every
 * wire value is validated against, and it refuses `edits` and `auto` on
 * purpose, because a mode is a consent and the harness will not translate one
 * name into another on the user's behalf. The translation lives exactly once,
 * at the wire boundary (`platform/harness/contracts/`), so a change here
 * touches no component and no wire value.
 *
 * The glyph each mode wears lives with the components that draw it
 * (`features/chat/permissions/modeIcon.ts`); this file is data only.
 */

export type PermissionMode = 'manual' | 'edits' | 'auto'

export interface PermissionModeSpec {
  readonly id: PermissionMode
  readonly name: string
  /** The one-line consequence, shown beside the name in the picker. */
  readonly note: string
  /** The longer form, for settings. */
  readonly detail: string
}

export const PERMISSION_MODES: readonly PermissionModeSpec[] = [
  {
    id: 'manual',
    name: 'Manual',
    note: 'Ask before everything.',
    detail:
      'Nothing runs without your approval. Every file write, command, and network request stops and asks first.',
  },
  {
    id: 'edits',
    name: 'Accept edits',
    note: 'Write files freely. Ask to run.',
    detail:
      'Reading and editing files inside the project happens without asking. Running commands and reaching the network still stop for approval.',
  },
  {
    id: 'auto',
    name: 'Full auto',
    note: 'Proceed unless a rule says ask.',
    detail:
      'Anything left at its default proceeds. Only the things a rule explicitly marks as ask will stop. Undo history still records every change.',
  },
]

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'manual'

export function findPermissionMode(id: PermissionMode): PermissionModeSpec {
  const mode = PERMISSION_MODES.find((candidate) => candidate.id === id)
  // The union makes this unreachable, and the throw is what keeps it that way
  // if the type is ever widened to a string from a stored preference.
  if (!mode) throw new Error(`Unknown permission mode: ${id}`)
  return mode
}
