import { base64OfBytes } from '@/lib/base64'
import { createHarnessClient, resolveHarnessAddress } from '@/platform/harness'
import { formatClock } from '@/features/voice/waveform'
import type { VoiceNote } from '@/features/voice/useMicInput'

/**
 * Speech to text. The seam, filled.
 *
 * Everything around it was already real: the microphone runs, the level is
 * measured, the audio is captured. What changed is the middle - the blob now
 * rides to the harness, which resolves the transcription slot (the model the
 * Providers pane names) and speaks to that provider. This module never learns
 * which one; it knows audio in, words out, and that is the whole contract.
 *
 * The address is resolved at call time, exactly as the workspace store does
 * for its client: a harness that restarted between two dictations is the live
 * one by the second call, not a stale endpoint. The answer is a result, not a
 * bare string, because two very different non-answers exist - nothing
 * listening, and a refusal that names its fix - and the composer shows the
 * note on the strip, so a failure is never typed into the field pretending to
 * be dictation.
 */
export type TranscriptionOutcome =
  | { readonly kind: 'ok'; readonly text: string }
  | { readonly kind: 'note'; readonly note: string }

export async function transcribeRecording(note: VoiceNote): Promise<TranscriptionOutcome> {
  const blob = note.blob
  if (blob === undefined || blob === null) {
    return {
      kind: 'note',
      note: `Nothing was captured for that ${formatClock(note.durationMs)} take - try again`,
    }
  }

  let bytes: Uint8Array
  try {
    bytes = new Uint8Array(await blob.arrayBuffer())
  } catch {
    return { kind: 'note', note: 'The recording could not be read - try again' }
  }

  const address = await resolveHarnessAddress()
  if (address === null) {
    return { kind: 'note', note: 'The harness is not running - start it below, then dictate again' }
  }

  const sent = await createHarnessClient(address).transcribe({
    audio: base64OfBytes(bytes),
    mimeType: blob.type === '' ? 'audio/webm' : blob.type,
  })
  if (!sent.ok) {
    return { kind: 'note', note: sentenceFor(sent.error.message) }
  }
  if (sent.value.text.trim() === '') {
    return {
      kind: 'note',
      note: 'Nothing intelligible came back - try again, a little closer to the mic',
    }
  }
  return { kind: 'ok', text: sent.value.text.trim() }
}

function sentenceFor(message: string): string {
  if (message.includes('No transcription model is connected')) {
    return 'No transcription model is connected - pick one in Settings - Providers'
  }
  return `Dictation failed: ${message}`
}
