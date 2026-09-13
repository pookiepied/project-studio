/**
 * The user's chosen default model per capability slot.
 */

import { isRecord } from '@/lib/guards'
import { CAPABILITY_SLOTS, type CapabilitySlot } from './picklists'
import { text } from './guards'

/** `modelReferenceSlotSchema` - one default, naming a model by its connection. */
export interface ModelReferenceSlot {
  readonly connectionId: string
  readonly modelId: string
}

/**
 * `defaultSelectionSchema` - the user's chosen defaults, per capability slot.
 * Only the slots actually set appear, which is the contract's own partialness:
 * most users set one or two and leave the rest to the harness.
 */
export type DefaultSelection = Partial<Record<CapabilitySlot, ModelReferenceSlot>>

export function parseProviderDefaults(value: unknown): DefaultSelection | null {
  if (!isRecord(value)) return null
  const selection: DefaultSelection = {}
  for (const slot of CAPABILITY_SLOTS) {
    const raw = value[slot]
    if (raw === undefined) continue
    if (!isRecord(raw)) return null
    const connectionId = text(raw['connectionId'])
    const modelId = text(raw['modelId'])
    if (connectionId === null || modelId === null) return null
    selection[slot] = { connectionId, modelId }
  }
  return selection
}
