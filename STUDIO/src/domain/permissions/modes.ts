import { Icons } from '@/components/icons'
import type { IconComponent } from '@/components/icons'

/**
 * Execution modes.
 *
 * Three, and they escalate. The wording is the design here: each one is written
 * as the consequence to the user's machine, not as the mechanism. "Auto-approve
 * tool calls" describes our implementation; "writes files without asking"
 * describes what happens to their work, and that is what someone is choosing
 * between.
 *
 * These are declared as data rather than hardcoded in the picker so the harness
 * can own the real set later. The UI reads whatever this exports, so replacing
 * it with a fetched policy changes no component.
 */

export type PermissionMode = 'manual' | 'edits' | 'auto'

export interface PermissionModeSpec {
  readonly id: PermissionMode
  readonly name: string
  /** The one-line consequence, shown beside the name in the picker. */
  readonly note: string
  /** The longer form, for settings. */
  readonly detail: string
  readonly icon: IconComponent
}

export const PERMISSION_MODES: readonly PermissionModeSpec[] = [
  {
    id: 'manual',
    name: 'Manual',
    note: 'Ask before everything.',
    detail:
      'Nothing runs without your approval. Every file write, command, and network request stops and asks first.',
    icon: Icons.permissionManual,
  },
  {
    id: 'edits',
    name: 'Accept edits',
    note: 'Write files freely. Ask to run.',
    detail:
      'Reading and editing files inside the project happens without asking. Running commands and reaching the network still stop for approval.',
    icon: Icons.permissionEdits,
  },
  {
    id: 'auto',
    name: 'Full auto',
    note: 'Proceed unless a rule says ask.',
    detail:
      'Anything left at its default proceeds. Only the things a rule explicitly marks as ask will stop. Undo history still records every change.',
    icon: Icons.permissionAuto,
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
