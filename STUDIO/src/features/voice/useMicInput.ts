import { useCallback, useEffect, useRef, useState } from 'react'
import { SegmentCutter } from '@/features/voice/segments'
import { voicedFrame } from '@/features/voice/speechDetector'

/**
 * The microphone, as a measured signal.
 *
 * ---- Why this exists, and what it refuses to do ---------------------------
 *
 * Every waveform in this app is driven by the level this hook reports. Nothing
 * downstream may invent motion: a bar that dances while the room is silent is
 * not a visualisation, it is a lie the user can hear the absence of. When the
 * microphone picks up nothing, the waveform sits still — that honesty is the
 * feature, because it is what tells the person speaking that the app is
 * actually listening rather than performing listening.
 *
 * The signal path is the short, standard one:
 *
 *   getUserMedia -> MediaStreamSource -> AnalyserNode -> getByteTimeDomainData
 *
 * RMS over the time-domain buffer, not frequency bins. RMS is loudness as a
 * single number, which is what a meter shows; the frequency data answers a
 * question nothing here asks (which band), costs more to compute, and invites
 * the fake-equaliser look this app deliberately does not have.
 *
 * ---- The processing chain, and why each stage is there ---------------------
 *
 *   gate        a raw floor below which the room, not the speaker, is loud.
 *               Below it the level is zero, so silence renders as silence.
 *   normalise   maps the gated RMS onto 0..1 between two fixed points. Speech
 *               at a normal distance peaks around 0.2 raw; the ceiling is set
 *               so that speaking lands in the top half without shouting.
 *   gamma       lifts quiet speech. Perceptual loudness is roughly logarithmic,
 *               so a linear mapping spends most of its travel on the loudest
 *               syllables and renders ordinary speech as a twitch at the
 *               bottom of the range.
 *   smoothing   asymmetric attack/release. Sound arrives in one frame; it
 *               decays over several. A meter that falls as fast as it rises
 *               flickers at syllable rate, and one that rises slowly never
 *               reaches the level of a short plosive. Fast up, slow down is
 *               how every hardware meter has always behaved.
 *
 * ---- Capture ----------------------------------------------------------------
 *
 * `start({ record: true })` also runs a MediaRecorder over the same stream, so
 * dictation has the actual audio to hand to a transcriber. The blob is real;
 * transcription itself is the seam in `transcribe.ts`.
 *
 * With `onSegment` as well, the recording is cut into segments while it runs
 * - at the pauses `SegmentCutter` finds in this same level - and each one is
 * handed over as it is cut, so the transcriber can start before the person
 * has finished. A segment is a whole file: a recorder's timeslice chunks are
 * not decodable on their own (only the first carries the container header),
 * so a cut is the recorder stopped and a new one started on the same stream,
 * not a chunk boundary. The final segment, whatever is left at `stop()`, is
 * the note `stop()` resolves with.
 *
 * The recorder is stopped before the tracks are, and the tracks only once it
 * has flushed. The other order - tracks first - ends the recorder's source
 * under it, and the flush that follows can be empty: a segment cut a moment
 * before the stop then came back as a file of zero bytes, which the harness
 * refused as no audio at all, and the whole take failed on its last word.
 *
 * ---- Errors -----------------------------------------------------------------
 *
 * Permission refused, no device, or no API at all are *states of the feature*,
 * not exceptions to log: the UI shows what happened and offers the way back
 * (see the blocked variants of the dictation strip and the voice stage).
 */

/** Where the gate opens. Below this, the room is loud, not the speaker. */
const NOISE_FLOOR = 0.012
/** Raw RMS that maps to a full bar. Ordinary speech peaks near 0.2. */
const LEVEL_CEILING = 0.17
/** Perceptual lift for quiet speech — see the chain notes above. */
const GAMMA = 0.8
/** Fraction of the gap closed per 16.7ms frame. Fast up... */
const ATTACK = 0.55
/** ...slow down. Release is what stops the syllable-rate flicker. */
const RELEASE = 0.11
/** How long a stopped recorder is given to flush before the take goes on without it. */
const FLUSH_GUARD_MS = 2_000

export type MicStatus = 'idle' | 'requesting' | 'live' | 'denied' | 'unavailable'

/**
 * One frame of measurement. `dtMs` lets callers integrate over real time;
 * `voiced` says whether the frame's spectrum looks like a voice rather than
 * a noise (see `speechDetector.ts`).
 */
export type MicFrameListener = (level: number, dtMs: number, voiced: boolean) => void

/** What a recording collected, handed to the transcriber. */
export interface VoiceNote {
  readonly blob: Blob | null
  readonly durationMs: number
}

interface MicNodes {
  take: (() => Promise<VoiceNote | null>) | null
  stream: MediaStream
  context: AudioContext
  analyser: AnalyserNode
  frame: number
  recorder: MediaRecorder | null
  /** The current recorder's own chunks; a rotated-out recorder keeps its own. */
  chunks: Blob[]
  startedAt: number
  /** When the current segment's recorder started; the take's start until the first cut. */
  segmentStartedAt: number
  /** The smoothed level the loop last computed, readable between frames. */
  level: number
  /** Decides the cuts, when segments were asked for. */
  cutter: SegmentCutter | null
  onSegment: ((note: VoiceNote) => void) | null
}

/** MediaRecorder mimetypes in preference order; the first supported wins. */
function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
  return candidates.find((type) => MediaRecorder.isTypeSupported(type))
}

export function useMicInput() {
  const [status, setStatus] = useState<MicStatus>('idle')
  const nodes = useRef<MicNodes | null>(null)
  const listeners = useRef(new Set<MicFrameListener>())

  /**
   * Subscribe to the measurement loop. The listener receives the smoothed
   * level (0..1) each animation frame while live; subscribers that paint
   * directly to the DOM from here never trigger a React render, which is what
   * keeps a 60fps waveform out of the reconciler entirely.
   */
  const onFrame = useCallback((listener: MicFrameListener) => {
    listeners.current.add(listener)
    return () => {
      listeners.current.delete(listener)
    }
  }, [])

  const start = useCallback(async (options?: {
    processing?: boolean
    record?: boolean
    /** Receives each segment as it is cut; asks for cutting by being given. */
    onSegment?: (note: VoiceNote) => void
  }): Promise<boolean> => {
    if (nodes.current) return true

    if (!navigator.mediaDevices?.getUserMedia) {
      // A context the API refuses to exist in (a non-secure origin, say). The
      // UI reports it; retrying cannot fix an origin, but the message tells
      // the user which world they are in.
      setStatus('unavailable')
      return false
    }

    setStatus('requesting')
    try {
      // The browser's DSP is refused on purpose. Echo cancellation clamps the
      // level of what it considers residue; noise suppression flattens the
      // quiet speech a meter most needs to show; auto gain rides the volume
      // like a second, slower meter fighting the first. The waveform's job is
      // to report the room, so the room is what it gets.
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: options?.processing ?? false, noiseSuppression: options?.processing ?? false, autoGainControl: options?.processing ?? false },
      })

      const context = new AudioContext()
      // Created inside a click, so a suspended context is the exception — but
      // a resumed one is one `await` cheaper to guarantee than an assumption.
      if (context.state === 'suspended') await context.resume()

      const analyser = context.createAnalyser()
      analyser.fftSize = 2048
      context.createMediaStreamSource(stream).connect(analyser)

      const recording = options?.record === true && typeof MediaRecorder !== 'undefined'
      // Each recorder collects into its own array, bound at creation: a
      // recorder being rotated out may still deliver one last chunk after
      // `stop()`, and it must land with its own segment, not the next one's.
      const startRecorder = (): { recorder: MediaRecorder; chunks: Blob[] } => {
        const own: Blob[] = []
        const type = pickMimeType()
        const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) own.push(event.data)
        }
        recorder.start(250)
        return { recorder, chunks: own }
      }
      const first = recording ? startRecorder() : null
      const recorder = first?.recorder ?? null
      const chunks = first?.chunks ?? []

      /** Ends the current segment and starts the next on the same stream. */
      const cut = (active: MicNodes) => {
        const finished = active.recorder
        const handOver = active.onSegment
        if (finished === null || handOver === null || finished.state === 'inactive') return
        const finishedChunks = active.chunks
        const now = performance.now()
        const durationMs = now - active.segmentStartedAt
        finished.onstop = () => {
          handOver({
            blob: new Blob(finishedChunks, { type: finished.mimeType || 'audio/webm' }),
            durationMs,
          })
        }
        finished.stop()
        const next = startRecorder()
        active.recorder = next.recorder
        active.chunks = next.chunks
        active.segmentStartedAt = now
      }

      const timeDomain = new Uint8Array(analyser.fftSize)
      const spectrum = new Float32Array(analyser.frequencyBinCount)
      let last = performance.now()

      const step = (now: number) => {
        const active = nodes.current
        if (!active) return

        // Clamped so a tab parked in the background cannot produce one giant
        // dt that jumps the release to a value from the distant past.
        const dtMs = Math.min(Math.max(now - last, 4), 100)
        last = now

        analyser.getByteTimeDomainData(timeDomain)
        let sum = 0
        for (let i = 0; i < timeDomain.length; i++) {
          // 128 is the byte-domain midpoint, so a missing sample centres
          // to zero -- silence -- rather than needing an assertion.
          const centred = ((timeDomain[i] ?? 128) - 128) / 128
          sum += centred * centred
        }
        const rms = Math.sqrt(sum / timeDomain.length)

        const gated = Math.max(0, rms - NOISE_FLOOR) / (LEVEL_CEILING - NOISE_FLOOR)
        const target = Math.pow(Math.min(1, gated), GAMMA)

        // Frame-rate independent: the fractions are authored against one
        // 60fps frame, then scaled by how much frame this actually was.
        const rate = Math.min(1, (dtMs / 16.7) * (target > active.level ? ATTACK : RELEASE))
        active.level += (target - active.level) * rate

        analyser.getFloatFrequencyData(spectrum)
        const voiced = voicedFrame(spectrum, context.sampleRate)
        for (const listener of listeners.current) listener(active.level, dtMs, voiced)
        if (active.cutter?.observe(active.level, dtMs) === true) cut(active)
        active.frame = requestAnimationFrame(step)
      }

      nodes.current = {
        take: null,
        stream,
        context,
        analyser,
        frame: requestAnimationFrame(step),
        recorder,
        chunks,
        startedAt: performance.now(),
        segmentStartedAt: performance.now(),
        level: 0,
        cutter: recording && options?.onSegment ? new SegmentCutter() : null,
        onSegment: recording ? (options?.onSegment ?? null) : null,
      }
      const active = nodes.current
      active.take = recording ? () => {
        const previous = active.recorder
        if (nodes.current !== active || previous === null || previous.state === 'inactive') return Promise.resolve(null)
        const previousChunks = active.chunks
        const durationMs = performance.now() - active.segmentStartedAt
        const next = startRecorder()
        active.recorder = next.recorder
        active.chunks = next.chunks
        active.segmentStartedAt = performance.now()
        return new Promise((resolve) => {
          let done = false
          const finish = () => {
            if (done) return
            done = true
            window.clearTimeout(timer)
            resolve({ blob: new Blob(previousChunks, { type: previous.mimeType || 'audio/webm' }), durationMs })
          }
          const timer = window.setTimeout(finish, FLUSH_GUARD_MS)
          previous.onstop = finish
          previous.onerror = finish
          previous.stop()
        })
      } : null
      setStatus('live')
      return true
    } catch (error) {
      // `NotAllowedError` is the user (or the platform) saying no;
      // `SecurityError` is the browser having already decided. Everything
      // else — no device, OS privacy switch off, the WebView refusing — is
      // reported as unavailable, because from this side they all look the
      // same: the call failed for a reason the app cannot argue with.
      setStatus(error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError') ? 'denied' : 'unavailable')
      return false
    }
  }, [])

  /**
   * Stops measuring. If this run was recording, the captured audio is
   * assembled here - once, on stop - and is what the promise resolves with:
   * the recorder flushes in its own `onstop`, a task after `stop()` returns,
   * and a timer racing that task used to lose now and then, which dropped
   * the last segment on the floor. `null` when not recording.
   */
  const stop = useCallback((): Promise<VoiceNote | null> => {
    const active = nodes.current
    if (!active) return Promise.resolve(null)
    nodes.current = null

    cancelAnimationFrame(active.frame)
    const release = () => {
      for (const track of active.stream.getTracks()) track.stop()
      void active.context.close()
    }
    setStatus('idle')

    // The note is the last segment: the whole take when nothing was cut,
    // what remains after the last cut when something was.
    const durationMs = performance.now() - active.segmentStartedAt
    const last = active.recorder
    const lastChunks = active.chunks
    if (!last || last.state === 'inactive') {
      release()
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      let done = false
      const settle = () => {
        if (done) return
        done = true
        window.clearTimeout(guard)
        release()
        resolve({ blob: new Blob(lastChunks, { type: last.mimeType || 'audio/webm' }), durationMs })
      }
      // A recorder that never reports its stop would hold the take in
      // "transcribing" for good; after this long, what it has flushed is
      // what there is.
      const guard = window.setTimeout(settle, FLUSH_GUARD_MS)
      last.onstop = settle
      last.onerror = settle
      last.stop()
    })
  }, [])

  useEffect(
    () => () => {
      void stop()
    },
    [stop],
  )

  const take = useCallback(() => nodes.current?.take?.() ?? Promise.resolve(null), [])
  /**
   * Holds the microphone closed without releasing it. A disabled track
   * delivers silence to the analyser and the recorder alike, so a muted room
   * is measured, recorded and sent as nothing at all.
   */
  const setMuted = useCallback((muted: boolean) => {
    for (const track of nodes.current?.stream.getAudioTracks() ?? []) track.enabled = !muted
  }, [])
  return { status, start, stop, take, onFrame, setMuted }
}
