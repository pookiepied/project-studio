import type { Effort, PermissionMode, TurnSettings } from '@/features/chat/session/types'

export interface EffortStop {
  value: Effort
  label: string
  /** One line explaining the trade, shown under the control as it changes. */
  hint: string
}

/**
 * The reasoning levels, in order. This array is the single source of both the
 * scale and its labels — no control hard-codes a count.
 */
export const EFFORT_STOPS: readonly EffortStop[] = [
  { value: 'low', label: 'Low', hint: 'Fastest. Best for short, direct questions.' },
  { value: 'medium', label: 'Medium', hint: 'Balanced reasoning for everyday work.' },
  { value: 'high', label: 'High', hint: 'Deeper analysis on harder problems.' },
  { value: 'max', label: 'Max', hint: 'Everything it has. Slowest, most thorough.' },
]

/**
 * The top stop. It used to earn a three-colour gradient and a one-shot light
 * sweep; both are gone. The app is monochrome, and a control that paints
 * itself indigo-to-amber to say "this setting is high" is decoration standing
 * in for hierarchy. Peak now reads through weight and fill, like everything
 * else.
 */
export const PEAK_EFFORT: Effort = 'max'

export function effortIndex(effort: Effort): number {
  return EFFORT_STOPS.findIndex((stop) => stop.value === effort)
}

export interface ModelOption {
  id: string
  label: string
  description: string
}

/**
 * Placeholder catalog. The real list is served by the harness's model registry
 * and replaces this wholesale — nothing else should hard-code a model id.
 */
export const MODEL_OPTIONS: readonly ModelOption[] = [
  { id: 'placeholder-balanced', label: 'Placeholder One', description: 'Balanced default' },
  { id: 'placeholder-fast', label: 'Placeholder Two', description: 'Fast and cheap' },
  { id: 'placeholder-deep', label: 'Placeholder Three', description: 'Most capable' },
]

export interface PermissionOption {
  value: PermissionMode
  label: string
  description: string
}

/**
 * Deliberately unnamed modes. The permissions slice replaces these labels with
 * real policies; naming them now would imply an enforcement that does not
 * exist yet.
 */
export const PERMISSION_OPTIONS: readonly PermissionOption[] = [
  { value: 'placeholder-one', label: 'Placeholder One', description: 'Reserved' },
  { value: 'placeholder-two', label: 'Placeholder Two', description: 'Reserved' },
  { value: 'placeholder-three', label: 'Placeholder Three', description: 'Reserved' },
]

export const DEFAULT_TURN_SETTINGS: TurnSettings = {
  modelId: MODEL_OPTIONS[0].id,
  effort: 'medium',
  permission: 'placeholder-one',
}
