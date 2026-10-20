import { useCallback, useEffect, useRef, useState } from 'react'
import { createConversationClient } from '@/platform/harness/conversation'
import { useMicInput } from './useMicInput'
import { transcribeRecording } from './transcribe'
import { speakText } from './speak'
import { openWebAudioSink } from './webAudioSink'
import { StreamingSpeech } from './streamingSpeech'
import { VoiceConversation, type VoiceFreshChat } from './conversation'
import { voiceModelSetting } from './settings'
import { captionTokens } from './captions'
import type { AudioSink } from './narration'
import { isContinuer, saidNothing, SpeechGate } from './speechDetector'

export type VoiceStage = 'connecting' | 'listening' | 'thinking' | 'speaking' | 'blocked'

export function useVoiceSession(active: boolean, conversationId: string | null = null, fresh?: VoiceFreshChat) {
  const [stage, setStage] = useState<VoiceStage>('connecting')
  const [note, setNote] = useState('')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [turn, setTurn] = useState(0)
  const [spoken, setSpoken] = useState<string[]>([])
  const [denied, setDenied] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [muted, setMutedState] = useState(false)
  // Deafened: Studio's voice is silenced while the reply still streams and the
  // caption still shows it. The microphone is a separate switch.
  const [deafened, setDeafenedState] = useState(false)
  const deafenedRef = useRef(false)
  const sink = useRef<AudioSink | null>(null)
  const mutedRef = useRef(false)
  const mic = useMicInput()
  const { start, stop, take, onFrame, setMuted } = mic
  const stageRef = useRef(stage)
  stageRef.current = stage
  const session = useRef<VoiceConversation | null>(null)
  const epoch = useRef(0)
  const transcriptQueue = useRef<Promise<void>>(Promise.resolve())
  const speechMs = useRef(0)
  const silenceMs = useRef(0)
  const sinceCut = useRef(0)
  const taking = useRef(false)
  const captions = useRef('')
  const takeSequence = useRef(0)
  const pendingTranscripts = useRef<string[]>([])
  // Talking over Studio holds its voice rather than cancelling it; what was
  // said decides afterwards (see the transcript handler below).
  const [holding, setHolding] = useState(false)
  const gate = useRef(new SpeechGate())
  const takeVoicedMs = useRef(0)
  // Read when a session starts, not a reason to restart one: the chat a
  // first utterance created keeps the same id and the same session.
  const freshRef = useRef(fresh)
  freshRef.current = fresh

  const moveTo = useCallback((next: VoiceStage) => { stageRef.current = next; setStage(next) }, [])
  const fail = useCallback((message: string) => {
    session.current?.close()
    session.current = null
    void stop()
    setNote(message)
    moveTo('blocked')
  }, [moveTo, stop])
  const interrupt = useCallback(() => {
    session.current?.interrupt()
    setHolding(false)
    captions.current = ''
    setSpoken([])
    moveTo('listening')
  }, [moveTo])
  const hold = useCallback(() => {
    if (session.current === null || session.current.holding) return
    session.current.hold()
    setHolding(true)
  }, [])
  const release = useCallback(() => {
    session.current?.release()
    setHolding(false)
  }, [])

  const toggleDeafen = useCallback(() => {
    const next = !deafenedRef.current
    deafenedRef.current = next
    setDeafenedState(next)
    sink.current?.setMuted?.(next)
  }, [])

  const stopListening = useCallback(() => {
    if (taking.current || speechMs.current < 100) return
    taking.current = true
    speechMs.current = 0
    silenceMs.current = 0
    sinceCut.current = performance.now()
    const current = epoch.current
    takeVoicedMs.current = 0
    gate.current.reset()
    const sequence = ++takeSequence.current
    const owner = session.current
    // Words said while Studio talks or thinks hold it, never cancel it, until
    // they are known; otherwise the turn is the person's, and Studio thinks.
    const overStudio = stageRef.current === 'speaking' || stageRef.current === 'thinking'
    if (overStudio) hold()
    else moveTo('thinking')
    const recording = take()
    transcriptQueue.current = transcriptQueue.current.then(async () => {
      const audio = await recording
      taking.current = false
      if (current !== epoch.current || owner === null || owner !== session.current || audio === null) return
      const answer = await transcribeRecording(audio, { segment: true })
      if (current !== epoch.current || owner !== session.current) return
      // One take the transcriber could not read - a provider rate limit, a
      // dropped request - costs that take, not the call: the stage says what
      // was missed and goes back to listening so it can be said again.
      if (answer.kind === 'note') {
        setNote(/\b429\b|rate/i.test(answer.note)
          ? 'Missed that. The transcription service is busy right now, so say it again in a moment.'
          : 'Missed that. The transcription did not come back, so say it again.')
        if (sequence === takeSequence.current && speechMs.current < 120) {
          if (owner.holding) release()
          else moveTo('listening')
        }
        return
      }
      const latest = sequence === takeSequence.current && speechMs.current < 120
      // The soft interrupt's verdict. Nothing intelligible (a sound that got
      // past the detector) or only "yeah, go on" lets Studio carry on from
      // the word it paused on; anything else is a turn, and only then is the
      // reply Studio was giving cancelled.
      if (owner.holding && pendingTranscripts.current.length === 0 && (saidNothing(answer.text) || isContinuer(answer.text))) {
        if (latest) release()
        return
      }
      if (!saidNothing(answer.text)) pendingTranscripts.current.push(answer.text)
      // Preserve an earlier utterance while the user is already correcting it.
      // Submit both verbatim once the newer take is transcribed.
      if (!latest) return
      if (pendingTranscripts.current.length === 0) {
        if (owner.holding) release()
        else moveTo('listening')
        return
      }
      setNote('')
      const text = pendingTranscripts.current.join('\n\n')
      pendingTranscripts.current = []
      if (owner.holding) interrupt()
      moveTo('thinking')
      captions.current = ''
      setSpoken([])
      setTurn((value) => value + 1)
      await owner.send(text)
    }).catch(() => { if (current === epoch.current) fail('Voice input failed. Try again.') })
  }, [take, moveTo, fail, hold, release, interrupt])

  /**
   * Closes or reopens the microphone. Speech already in the take - a sentence
   * finished a moment before the mute, still inside its pause - is the
   * person's turn, so muting sends it as the pause would have. A take with
   * no speech in it is only room sound and is dropped. Anything already being
   * transcribed or answered is left alone.
   */
  const toggleMute = useCallback(() => {
    const next = !mutedRef.current
    if (next && speechMs.current >= 120) stopListening()
    mutedRef.current = next
    setMutedState(next)
    setMuted(next)
    speechMs.current = 0
    silenceMs.current = 0
    sinceCut.current = performance.now()
    if (next && !taking.current) void take()
  }, [setMuted, take, stopListening])


  useEffect(() => {
    if (!active) return
    const current = ++epoch.current
    moveTo('connecting')
    setNote('')
    const started = performance.now()
    const clock = window.setInterval(() => {
      const now = performance.now()
      setElapsedMs(now - started)
      if (stageRef.current !== 'connecting' && stageRef.current !== 'blocked' && !taking.current && now - sinceCut.current >= 60_000) {
        fail('That recording exceeded one minute. Reopen voice mode and use shorter turns; nothing from this take was submitted.')
      }
    }, 250)
    void (async () => {
      if (conversationId === null) { fail('Open a chat before starting voice mode.'); return }
      const setting = await voiceModelSetting()
      if (current !== epoch.current) return
      if (!setting.ok) { fail(setting.error.message); return }
      if (setting.value.modelId === null) { fail('Choose a voice conversation model in Settings - Models.'); return }
      const owner = new VoiceConversation({
        client: createConversationClient({ conversationId }),
        output: () => new StreamingSpeech({
          speak: speakText,
          openSink: (onEnded) => {
            const opened = openWebAudioSink(onEnded)
            opened.setMuted?.(deafenedRef.current)
            sink.current = opened
            return opened
          },
          onPlaying: () => { if (current === epoch.current) moveTo('speaking') },
          // The caption grows a phrase at a time as each one starts to sound,
          // so it shows what is being said rather than what has streamed in.
          onPhrase: (phrase) => {
            if (current !== epoch.current) return
            captions.current = `${captions.current}${captions.current === '' ? '' : ' '}${phrase}`.slice(-6000)
            setSpoken(captionTokens(captions.current))
          },
          onDone: () => { if (current === epoch.current && stageRef.current !== 'blocked') moveTo('listening') },
          onFailure: (message) => { if (current === epoch.current) fail(message) },
        }),
        onText: () => {},
        onFailure: (message) => { if (current === epoch.current) fail(message) },
        ...(freshRef.current === undefined ? {} : { fresh: freshRef.current }),
      })
      session.current = owner
      owner.start()
      const live = await start({ record: true, processing: true })
      if (current !== epoch.current || session.current !== owner) { void stop(); owner.close(); return }
      if (!live) { setDenied(true); fail('The microphone is unavailable or blocked. Check microphone permissions, then try again.'); return }
      setMuted(mutedRef.current)
      speechMs.current = 0
      silenceMs.current = 0
      sinceCut.current = performance.now()
      taking.current = false
      moveTo('listening')
    })().catch(() => { if (current === epoch.current) fail('Voice mode could not connect. Try again.') })
    return () => {
      epoch.current = current + 1
      window.clearInterval(clock)
      session.current?.close()
      session.current = null
      void stop()
      taking.current = false
      transcriptQueue.current = Promise.resolve()
      pendingTranscripts.current = []
      setHolding(false)
    }
  }, [active, conversationId, retryCount, start, stop, moveTo, fail, setMuted])

  useEffect(() => {
    if (!active) return
    return onFrame((raw, dtMs, voiced) => {
      if (stageRef.current === 'blocked' || stageRef.current === 'connecting') return
      const level = mutedRef.current ? 0 : raw
      const loud = level >= 0.085
      // A voice held for a quarter second, not just a loud frame: claps,
      // knocks and typing never get this far (see `speechDetector.ts`).
      const talking = gate.current.observe(loud, voiced, dtMs)
      if (loud && voiced) takeVoicedMs.current += dtMs
      if (loud) {
        speechMs.current += dtMs
        silenceMs.current = 0
        // Talking over Studio pauses it; the words decide what happens next.
        if (talking && (stageRef.current === 'speaking' || stageRef.current === 'thinking')) hold()
      } else if (level < 0.05) silenceMs.current += dtMs
      if (speechMs.current >= 120 && silenceMs.current >= 500) {
        if (takeVoicedMs.current >= 150 || mutedRef.current) stopListening()
        else {
          // Loud but never a voice: room sound. It is dropped here instead
          // of being sent to the transcriber, and Studio is not disturbed.
          speechMs.current = 0
          silenceMs.current = 0
          takeVoicedMs.current = 0
          sinceCut.current = performance.now()
          if (!taking.current) void take()
        }
      }
      // Bound silent recordings without sending room noise to a provider.
      if (speechMs.current === 0 && performance.now() - sinceCut.current >= 10_000 && !taking.current) {
        sinceCut.current = performance.now()
        void take()
      }
    })
  }, [active, onFrame, take, hold, stopListening])

  const retry = useCallback(() => { setDenied(false); setRetryCount((value) => value + 1) }, [])
  return { stage, elapsedMs, turn, spoken, denied, note, muted, deafened, holding, toggleMute, toggleDeafen, stopListening, interrupt, retry, mic }
}
