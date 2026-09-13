import { createHarnessClient, resolveHarnessAddress } from '@/platform/harness'

/**
 * The dictated passage, tidied by the harness on the default text model.
 *
 * The seam beside `transcribe.ts`, in the same two shapes: the words came
 * back, or one sentence about why they did not. The harness does the work
 * - a fixed-prompt agent that keeps the person's words and fixes what a
 * transcriber gets wrong - and this module only carries the passage there
 * and the answer back. Nothing is remembered on either side.
 */

export type ImproveOutcome =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'note'; readonly note: string }

export async function improveDictation(text: string): Promise<ImproveOutcome> {
  const address = await resolveHarnessAddress()
  if (address === null) {
    return { kind: 'note', note: 'The harness is not running - start it below, then try again' }
  }
  const sent = await createHarnessClient(address).improveText(text)
  if (!sent.ok) return { kind: 'note', note: sentenceFor(sent.error.message) }
  const improved = sent.value.text.trim()
  if (improved === '') return { kind: 'note', note: 'Nothing came back - the text is as you said it' }
  return { kind: 'ok', text: improved }
}

function sentenceFor(message: string): string {
  if (message.includes('No text model') || message.includes('No language model')) {
    return 'No text model is connected - pick one in Settings - Providers'
  }
  return `Improve failed: ${message}`
}
