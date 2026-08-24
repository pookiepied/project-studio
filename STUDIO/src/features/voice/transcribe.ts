import { formatClock } from '@/features/voice/waveform'
import type { VoiceNote } from '@/features/voice/useMicInput'

/**
 * Speech to text. This is the seam.
 *
 * Everything around it is real: the microphone runs, the level is measured,
 * the audio is captured. This function is where a model plugs in — send
 * `note.blob` to an ASR endpoint (Whisper, the provider of your choice) and
 * return its text. The signature is deliberately the whole contract: audio
 * in, text out, asynchronous, no UI knowledge.
 *
 * Until a model is connected, the demo below stands in. It keeps the honest
 * latency a round trip will really have (so the processing state is paced by
 * something other than a developer's patience) and returns a bracketed note
 * that says exactly what it is — a stand-in, marked in the text itself, so a
 * dictated placeholder can never be mistaken for a transcript.
 */
export async function transcribeRecording(note: VoiceNote): Promise<string> {
  // A plausible round trip: short for a short note, capped so a long
  // recording never parks the composer.
  const latency = 380 + Math.min(900, note.durationMs * 0.03)
  await new Promise((resolve) => setTimeout(resolve, latency))

  const length = note.blob ? `${(note.blob.size / 1024).toFixed(0)} kB` : formatClock(note.durationMs)
  return `[Voice note · ${formatClock(note.durationMs)} · ${length} — transcript arrives when speech-to-text is connected]`
}
