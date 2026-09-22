import type { CapabilitySlot } from '@/platform/harness'

/**
 * The Media page's categories: what the slots are grouped into when a person
 * comes to choose a provider or a model for a kind of media.
 *
 * The contract has six media slots and the page used to show all six as one
 * list under one list of every media connection, which made a page about
 * "which model paints" also a page about dictation and about a video house
 * nobody uses for images. The grouping follows the vendors: a category is a
 * set of slots one vendor tends to serve together, so choosing a category is
 * choosing which providers are even relevant.
 *
 *   Images  generation and editing. Every image vendor does both (GPT Image,
 *           Gemini, FAL), and splitting them shows the same providers twice.
 *   Video   generation, with its own vendors.
 *   Voice   speech and transcription. The audio vendors are voice houses -
 *           ElevenLabs, Deepgram, Fish Audio serve both directions.
 *   Documents  reading a PDF or a scanned page as text: an OCR engine
 *           (Mistral) or a vision model that takes a file (OpenAI, Google,
 *           OpenRouter). One slot; the read tool escalates to it for pages
 *           with no text layer.
 *
 * Embeddings has no category and so no place on the page: nothing invokes it
 * yet, and a picker for something that cannot be used is the clutter this
 * grouping exists to remove. It returns with the feature that needs it.
 */

export type MediaCategory = 'images' | 'video' | 'voice' | 'documents'

export interface MediaCategoryInfo {
  readonly id: MediaCategory
  readonly name: string
  /** One line under the switch, saying what the category's defaults drive. */
  readonly description: string
  readonly slots: readonly CapabilitySlot[]
}

export const MEDIA_CATEGORIES: readonly MediaCategoryInfo[] = [
  {
    id: 'images',
    name: 'Images',
    description: 'The models that make and edit pictures for the image tools.',
    slots: ['imageGeneration', 'imageEditing'],
  },
  {
    id: 'video',
    name: 'Video',
    description: 'The model that renders clips for the video tool.',
    slots: ['videoGeneration'],
  },
  {
    id: 'voice',
    name: 'Voice',
    description: 'The voice that reads replies aloud, and the ear that takes dictation.',
    slots: ['speechGeneration', 'transcription'],
  },
  {
    id: 'documents',
    name: 'Documents',
    description: 'The model that reads a scanned page or a whole PDF as text when the read tool asks.',
    slots: ['documentReading'],
  },
]

/**
 * What a slot is called inside its category, where the category's name
 * already carries the medium: "Generate" under Images, not "Images" under
 * Images. Slots outside the categories keep their product label elsewhere.
 */
export const SLOT_VERBS: Readonly<Partial<Record<CapabilitySlot, string>>> = {
  imageGeneration: 'Generate',
  imageEditing: 'Edit',
  videoGeneration: 'Generate',
  speechGeneration: 'Read aloud',
  transcription: 'Dictation',
  documentReading: 'Read',
}

export function mediaCategory(id: MediaCategory): MediaCategoryInfo {
  const found = MEDIA_CATEGORIES.find((category) => category.id === id)
  if (found === undefined) throw new Error(`No media category is called ${id}.`)
  return found
}

/** Whether any of the slots falls in the category. */
export function servesCategory(slots: readonly CapabilitySlot[], category: MediaCategoryInfo): boolean {
  return slots.some((slot) => category.slots.includes(slot))
}
