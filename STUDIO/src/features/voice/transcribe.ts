import { base64OfBytes } from '@/lib/base64'
import { createHarnessClient, resolveHarnessAddress, type HarnessFailure } from '@/platform/harness'
import { formatClock } from '@/features/voice/waveform'
import type { VoiceNote } from '@/features/voice/useMicInput'
import { recordingAudio } from '@/features/voice/recordingAudio'

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

/** A second try, this long after a first answer that a moment could change. */
const RETRY_AFTER_MS = 600

/**
 * `segment: true` is live dictation's reading of an empty answer: one
 * segment of a take may hold a breath or a cough and transcribe to nothing,
 * which is not a failure of the take. The whole-take reading, the default,
 * still says so in a sentence, because a whole take that came back empty is
 * a thing the person should hear about.
 *
 * A file of no bytes is read the same way. The recorder can flush one - a
 * segment cut a moment before the stop, a source that ended under it - and
 * it used to ride to the harness as an empty string, which the route refused
 * as a malformed body. That refusal named the wire ("must be base64"), which
 * is a true sentence about the wrong thing: nothing was said.
 *
 * A refusal that a moment could change - the harness briefly unreachable, a
 * timeout, a provider answering 429 or 5xx - is tried once more before it is
 * reported. Live dictation posts a take as many segments, and one segment
 * failing ends the take, so a passing fault that a single retry would clear
 * used to cost the whole passage. A refusal that would repeat is reported
 * at once.
 */
export async function transcribeRecording(
  note: VoiceNote,
  options: { readonly segment?: boolean } = {},
): Promise<TranscriptionOutcome> {
  const blob = note.blob
  if (blob === undefined || blob === null || blob.size === 0) {
    if (options.segment) return { kind: 'ok', text: '' }
    return {
      kind: 'note',
      note: `Nothing was captured for that ${formatClock(note.durationMs)} take - try again`,
    }
  }

  const address = await resolveHarnessAddress()
  if (address === null) {
    return { kind: 'note', note: 'The harness is not running - start it below, then dictate again' }
  }

  let bytes: Uint8Array
  try {
    bytes = await recordingAudio(blob)
  } catch {
    return { kind: 'note', note: 'The recording could not be decoded - try recording again' }
  }

  const client = createHarnessClient(address)
  const recording = {
    audio: base64OfBytes(bytes),
    mimeType: 'audio/wav',
  }
  let sent = await client.transcribe(recording)
  if (!sent.ok && worthRetrying(sent.error)) {
    await new Promise((resolve) => setTimeout(resolve, RETRY_AFTER_MS))
    sent = await client.transcribe(recording)
  }
  if (!sent.ok) {
    return { kind: 'note', note: sentenceFor(sent.error.message) }
  }
  if (sent.value.text.trim() === '') {
    if (options.segment) return { kind: 'ok', text: '' }
    return {
      kind: 'note',
      note: 'Nothing intelligible came back - try again, a little closer to the mic',
    }
  }
  return { kind: 'ok', text: sent.value.text.trim() }
}

/**
 * Whether the same request, sent again in a moment, could be answered. A
 * dead socket or a timeout can be a blink; a provider's 429 or 5xx is one
 * by definition. A 400 is this body, and a refusal to a connected model
 * that is missing is a setting, and neither changes by itself.
 */
function worthRetrying(failure: HarnessFailure): boolean {
  if (failure.kind === 'not-reachable') return true
  if (failure.kind !== 'harness-error') return false
  // The harness names the slot by its product word, dictation - not the
  // capability slot's own name. The match is against the sentence the slot
  // resolver actually sends (see `LABELS` in the media resolver).
  if (failure.message.includes('No dictation model is connected')) return false
  return failure.status === 429 || failure.status >= 500
}

function sentenceFor(message: string): string {
  if (message.includes('No dictation model is connected')) {
    return 'No dictation model is connected - pick one in Settings - Providers'
  }
  return `Dictation failed: ${message}`
}
