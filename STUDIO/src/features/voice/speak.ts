import { createHarnessClient, resolveHarnessAddress } from '@/platform/harness'

/**
 * Text to speech. The twin of `transcribe.ts`, and the same shape on purpose:
 * the person is the invoker, so this is a plain client call, not a tool - the
 * harness resolves the speech slot and speaks to that provider, and this
 * module never learns which one.
 */
export type SpeechOutcome =
  | { readonly kind: 'ok'; readonly audio: string; readonly mimeType: string }
  | { readonly kind: 'note'; readonly note: string }

export async function speakText(text: string): Promise<SpeechOutcome> {
  const address = await resolveHarnessAddress()
  if (address === null) {
    return { kind: 'note', note: 'The harness is not running - start it below, then try again' }
  }
  const sent = await createHarnessClient(address).speak({ text })
  if (!sent.ok) {
    const message = sent.error.message
    if (message.includes('No read-aloud model is connected')) {
      return { kind: 'note', note: 'No read-aloud model is connected - pick one in Settings - Providers' }
    }
    return { kind: 'note', note: `Read-aloud failed: ${message}` }
  }
  if (sent.value.audio === '') {
    return { kind: 'note', note: 'The speech provider returned no audio' }
  }
  return { kind: 'ok', audio: sent.value.audio, mimeType: sent.value.mimeType }
}
