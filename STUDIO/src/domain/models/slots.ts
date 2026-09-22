import { CAPABILITY_SLOTS, type CapabilitySlot } from '@/platform/harness'

/**
 * The ten capability slots, with the words the product uses for them.
 *
 * `CAPABILITY_SLOTS` is the contract's own list; this file is the only place
 * that gives the slots display copy, so a slot added to the contract has
 * exactly one label to add here and nowhere else. The labels are short on
 * purpose: they appear as chips on library rows, in slot pickers, and in the
 * one sentence a slot with nothing connected shows.
 */
export const SLOT_LABELS: Readonly<Record<CapabilitySlot, string>> = {
  textGeneration: 'Chat',
  imageGeneration: 'Images',
  imageEditing: 'Image editing',
  videoGeneration: 'Video',
  speechGeneration: 'Speech',
  transcription: 'Transcription',
  documentReading: 'Document reading',
  embeddings: 'Embeddings',
  webSearch: 'Web search',
  webFetch: 'Web fetch',
}

/**
 * Fails to compile when the contract grows a slot and the labels do not.
 * Same guard `draft.ts` runs on the protocol list.
 */
const _everySlotHasALabel: Record<CapabilitySlot, string> = SLOT_LABELS
void _everySlotHasALabel

/** Every slot, in the contract's order, for pickers that offer all of them. */
export const ALL_SLOTS: readonly CapabilitySlot[] = CAPABILITY_SLOTS
