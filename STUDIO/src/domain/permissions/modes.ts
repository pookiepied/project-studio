/**
 * Execution modes.
 *
 * Two, since ADR 0057. The wording is the design here: each one is written
 * as the consequence to the user's machine, not as the mechanism. "Auto-
 * approve tool calls" describes our implementation; "proceeds without
 * asking" describes what happens to their work, and that is what someone is
 * choosing between.
 *
 * There used to be a third between them, "Accept edits": write files
 * freely, ask to run. It drew its line where the OS container drew one, and
 * with the container gone (ADR 0057) that consent is one lasting answer to
 * the first write question - this project, always - under Ask, rather than
 * a mode of its own. A rule the person writes that way holds in both modes;
 * the mode only says what happens to a call no rule covers.
 *
 * These ids are the harness's own names (`ask` / `auto`) as well: one
 * vocabulary, validated on the wire at `platform/harness/contracts/`, so a
 * value this file cannot describe is refused there rather than translated.
 *
 * The glyph each mode wears lives with the components that draw it
 * (`features/chat/permissions/modeIcon.ts`); this file is data only.
 */

export type PermissionMode = 'ask' | 'auto'

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
    id: 'ask',
    name: 'Ask',
    note: 'Ask before anything, unless you said always.',
    detail:
      'Every file write, command, and network request stops and asks first. An answer you gave as "always" holds, so a project you have let Studio edit is edited without asking and still stops before running anything.',
  },
  {
    id: 'auto',
    name: 'Auto',
    note: 'Proceed unless a rule says ask.',
    detail:
      'Anything left at its default proceeds. Only the things a rule explicitly marks as ask will stop. Undo history still records every change.',
  },
]

export const DEFAULT_PERMISSION_MODE: PermissionMode = 'ask'

export function findPermissionMode(id: PermissionMode): PermissionModeSpec {
  const mode = PERMISSION_MODES.find((candidate) => candidate.id === id)
  // The union makes this unreachable, and the throw is what keeps it that way
  // if the type is ever widened to a string from a stored preference.
  if (!mode) throw new Error(`Unknown permission mode: ${id}`)
  return mode
}
