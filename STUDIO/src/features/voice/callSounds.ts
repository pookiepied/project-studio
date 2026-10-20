/**
 * The call's small sounds.
 *
 * Synthesised, not sampled: each cue is two or three soft sine notes on Web
 * Audio, so there is no asset to load and every cue shares one timbre. The
 * shape carries the meaning the way it does on every call app people know:
 * rising is someone arriving or something turning on, falling is someone
 * leaving or something turning off, and the pitch says who - the call itself
 * sits low, helpers joining and leaving sit higher and quieter.
 *
 * Interrupting has no cue on purpose: it is the person cutting in, and a chime
 * on top of their own voice would be one more thing talking over them.
 *
 * Quiet by design (peak gain 0.08) and safe to call anywhere: with no Web
 * Audio, or a context the platform refuses, a cue is simply silent.
 */

export type CallCue =
  | 'join'
  | 'leave'
  | 'agentJoin'
  | 'agentLeave'
  | 'mute'
  | 'unmute'
  | 'deafen'
  | 'undeafen'

/** Notes as [frequency in Hz, start offset in seconds]. */
const CUES: Record<CallCue, { notes: readonly (readonly [number, number])[]; gain: number }> = {
  join: { notes: [[523.25, 0], [659.25, 0.09], [783.99, 0.18]], gain: 0.08 },
  leave: { notes: [[783.99, 0], [659.25, 0.09], [523.25, 0.18]], gain: 0.08 },
  agentJoin: { notes: [[880, 0], [1174.66, 0.07]], gain: 0.05 },
  agentLeave: { notes: [[1174.66, 0], [880, 0.07]], gain: 0.05 },
  mute: { notes: [[440, 0], [329.63, 0.06]], gain: 0.06 },
  unmute: { notes: [[329.63, 0], [440, 0.06]], gain: 0.06 },
  deafen: { notes: [[392, 0], [261.63, 0.07]], gain: 0.06 },
  undeafen: { notes: [[261.63, 0], [392, 0.07]], gain: 0.06 },
}

const NOTE_SECONDS = 0.16

let shared: AudioContext | null = null

export function playCue(cue: CallCue): void {
  try {
    if (typeof AudioContext === 'undefined') return
    shared ??= new AudioContext()
    const context = shared
    if (context.state === 'suspended') void context.resume()
    const { notes, gain } = CUES[cue]
    const now = context.currentTime + 0.01
    for (const [frequency, offset] of notes) {
      const oscillator = context.createOscillator()
      const envelope = context.createGain()
      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      // A fast attack and an exponential tail: a soft bell, not a beep.
      envelope.gain.setValueAtTime(0.0001, now + offset)
      envelope.gain.exponentialRampToValueAtTime(gain, now + offset + 0.012)
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + offset + NOTE_SECONDS)
      oscillator.connect(envelope).connect(context.destination)
      oscillator.start(now + offset)
      oscillator.stop(now + offset + NOTE_SECONDS + 0.02)
    }
  } catch {
    // A cue is decoration; a platform that refuses audio loses nothing else.
  }
}
