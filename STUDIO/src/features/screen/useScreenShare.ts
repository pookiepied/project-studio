import { useCallback, useEffect, useRef, useState } from 'react'
import { isTauri, onScreenDrawingFinished, resetScreenOverlay, startScreenDrawing } from '@/platform/tauri'
import { useWorkspace } from '@/stores/workspace'
import { matchControl } from './controlMatcher'

/**
 * The call's two screen switches (ADR 0059): Share screen, and Show me.
 *
 * Sharing is the person's, off when a call starts and off again when it
 * ends - never carried from one call to the next, never turned on by Studio.
 * While it is on, the harness samples the pointer and windows and the voice
 * agent may look; the moment the person stops speaking, a picture of the
 * display they point at is asked for, so it is ready by the time the agent
 * reads their words.
 *
 * Show me holds the agent back (`demonstrate` on the desktop lease) and puts
 * a pen on the screen. Done, in the overlay's own toolbar, gives the desktop
 * back; `useScreenCollaboration` hears it.
 *
 * Pause and Stop computer sit beside them: the person's two other controls
 * over whoever is driving, each a button press with no model in the way.
 */
export function useScreenShare(conversationId: string | null, open: boolean) {
  const { computer } = useWorkspace()
  const [sharing, setSharing] = useState(false)
  const [showing, setShowing] = useState(false)
  const [pending, setPending] = useState(false)
  const [paused, setPaused] = useState(false)
  const [note, setNote] = useState('')
  const available = isTauri() && conversationId !== null

  const live = useRef({ sharing, showing, paused, conversationId, computer })
  live.current = { sharing, showing, paused, conversationId, computer }

  const toggle = useCallback(async () => {
    const id = live.current.conversationId
    if (id === null) return
    const next = !live.current.sharing
    setPending(true)
    setNote('')
    const answer = await live.current.computer.share(id, next)
    setPending(false)
    if (!answer.ok) { setNote(answer.error.message); return }
    setSharing(answer.value)
    if (!answer.value) {
      void resetScreenOverlay()
      if (live.current.showing) { setShowing(false); void live.current.computer.control(id, 'resume') }
    }
  }, [])

  // Each action answers the sentence it showed, so a spoken command can
  // carry the same words to the agent as a button press shows the person.
  const showMe = useCallback(async (): Promise<string> => {
    const id = live.current.conversationId
    if (id === null || !live.current.sharing) return 'Show me needs the screen shared first.'
    if (live.current.showing) return 'The person is already showing something.'
    setNote('')
    const held = await live.current.computer.control(id, 'demonstrate')
    if (!held.ok) { setNote(held.error.message); return held.error.message }
    setShowing(true)
    return startScreenDrawing(id).then(
      () => 'The person is showing something and drawing on the screen; automation is held until they press Done.',
      () => {
        setShowing(false)
        const said = 'The drawing layer could not open on this display.'
        setNote(said)
        void live.current.computer.control(id, 'resume')
        return said
      },
    )
  }, [])

  /**
   * Pause and resume, straight to the desktop lease with no model between
   * (D4). Paused is what the lease said, not what was pressed: a pause that
   * reached another conversation's desktop, or none, says so instead.
   */
  const setPause = useCallback(async (pause: boolean): Promise<string> => {
    const id = live.current.conversationId
    if (id === null) return 'There is no conversation to pause.'
    setNote('')
    const answer = await live.current.computer.control(id, pause ? 'pause' : 'resume')
    if (!answer.ok) { setNote(answer.error.message); return answer.error.message }
    const said = answer.value
    if (said === 'paused' || said === 'already') { setPaused(true); return 'Computer work is paused.' }
    if (said === 'resumed' || said === 'not_paused') { setPaused(false); return 'Computer work is resumed; whoever had it looks again before acting.' }
    const note = said === 'other_conversation' ? 'Another conversation is using the computer. Pause it there.' : 'Nothing is using the computer right now.'
    setNote(note)
    return note
  }, [])

  const togglePause = useCallback(() => setPause(!live.current.paused), [setPause])

  /**
   * Stop computer: the driver ends and anything it held is let go. Reported
   * as one of three facts, never rounded up: stopped, asked for but not
   * confirmed, or nothing running. Tasks are not cancelled here; their next
   * computer call is refused and they say so.
   */
  const stopComputer = useCallback(async (): Promise<string> => {
    const id = live.current.conversationId
    if (id === null) return 'There is no conversation to stop.'
    setNote('Stopping the computer...')
    const answer = await live.current.computer.stop(id)
    setPaused(false)
    if (!answer.ok) { setNote(answer.error.message); return answer.error.message }
    const said = {
      cleanup_confirmed: 'Computer stopped.',
      cleanup_unconfirmed: 'Stop sent. Studio could not confirm the computer let go of everything.',
      not_running: 'Nothing was using the computer.',
      unavailable: 'Computer control is not available here.',
    }[answer.value]
    setNote(said)
    return said
  }, [])

  /**
   * A final transcript, before it is sent: if it is one of the few spoken
   * commands (`controlMatcher.ts`), do it now and answer what happened, to
   * ride on the utterance; otherwise undefined, and the model decides.
   */
  const onFinalUtterance = useCallback(async (text: string): Promise<string | undefined> => {
    if (live.current.conversationId === null) return undefined
    const control = matchControl(text, { paused: live.current.paused, sharing: live.current.sharing })
    if (control === null) return undefined
    const done = control === 'stop_computer' ? await stopComputer()
      : control === 'pause' ? await setPause(true)
      : control === 'resume' ? await setPause(false)
      : await showMe()
    return `Studio already acted on these words as a command (${control}): ${done} Acknowledge it; do not do it again.`
  }, [setPause, showMe, stopComputer])

  /** As the person stops speaking: a picture of where they are pointing, if they are sharing. */
  const onSpeechEnd = useCallback(() => {
    const id = live.current.conversationId
    if (id !== null && live.current.sharing) void live.current.computer.glance(id)
  }, [])

  useEffect(() => {
    let alive = true
    let stop: (() => void) | null = null
    void onScreenDrawingFinished((finishedFor) => {
      if (finishedFor === live.current.conversationId) setShowing(false)
    }).then((unlisten) => { if (alive) stop = unlisten; else unlisten() })
    return () => { alive = false; stop?.() }
  }, [])

  // The call ending - or moving to another conversation - ends sharing with
  // it. Studio never carries the person's screen into the next call.
  useEffect(() => {
    if (open) return
    const { sharing: wasSharing, showing: wasShowing, conversationId: id, computer: client } = live.current
    if (id === null || !wasSharing) return
    setSharing(false)
    setShowing(false)
    void resetScreenOverlay()
    void client.share(id, false)
    if (wasShowing) void client.control(id, 'resume')
  }, [open])

  // The id is the effect's own, not the ref's: by the time this cleanup
  // runs for a change of conversation, the ref already names the new one.
  useEffect(() => {
    const id = conversationId
    return () => {
      const { sharing: wasSharing, showing: wasShowing, computer: client } = live.current
      if (id === null || !wasSharing) return
      setSharing(false)
      setShowing(false)
      void resetScreenOverlay()
      void client.share(id, false)
      if (wasShowing) void client.control(id, 'resume')
    }
  }, [conversationId])

  return { available, sharing, showing, paused, pending, note, toggle, showMe, togglePause, stopComputer, onSpeechEnd, onFinalUtterance }
}
