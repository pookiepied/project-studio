import { useEffect, useMemo, useRef } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION, EASE_OUT, SHELL } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { Button } from '@/components/primitives'
import { IconButton } from '@/components/primitives'
import {
  formatClock,
  idleBreath,
  prefersReducedMotion,
  speakingEnvelope,
  thinkingPulse,
} from '@/features/voice/waveform'
import { useVoiceSession } from '@/features/voice/useVoiceMode'
import type { VoiceFreshChat } from '@/features/voice/conversation'
import { ParticipantStack, useCallParticipants } from './CallParticipants'
import { CritterAvatar, StudioAvatar, moodOf } from './avatars'
import { Caption } from './Caption'
import { playCue } from './callSounds'
import { ApprovalPrompt } from '@/features/chat/permissions/ApprovalPrompt'
import { usePendingApprovals } from '@/features/chat/permissions/usePendingApprovals'
import { useScreenShare } from '@/features/screen/useScreenShare'

type Screen = ReturnType<typeof useScreenShare>

/**
 * Share screen: the person's switch, off at the start of every call. Solid
 * while on, like mute and deafen, so the bar says at a glance what Studio
 * can see.
 */
function ShareButton({ screen, size }: { screen: Screen; size: 'md' | 'lg' }) {
  return (
    <IconButton
      label={screen.sharing ? 'Stop sharing your screen' : 'Share your screen'}
      size={size}
      tone={screen.sharing ? 'solid' : 'quiet'}
      disabled={screen.pending}
      onClick={() => void screen.toggle()}
    >
      <Icons.shareScreen size="md" />
    </IconButton>
  )
}

/** Show me: hold Studio back and draw on the screen. Only while sharing. */
function ShowMeButton({ screen, size }: { screen: Screen; size: 'md' | 'lg' }) {
  return (
    <IconButton
      label={screen.sharing ? 'Show me: draw on your screen' : 'Share your screen to draw on it'}
      size={size}
      tone={screen.showing ? 'solid' : 'quiet'}
      disabled={!screen.sharing || screen.showing}
      onClick={() => void screen.showMe()}
    >
      <Icons.showMe size="md" />
    </IconButton>
  )
}

/**
 * The voice stage: a call with Studio.
 *
 * ---- The room ----------------------------------------------------------------
 *
 * Studio sits in the middle as the orb - the one participant you talk to,
 * whose colour and motion are its state - with its name under it and its
 * words under that, two lines at a time. Workers join the call as small
 * critters in a row beneath; the row opens into a grid of cards that say what
 * each one is doing, and Studio's orb steps back while it is open.
 *
 * ---- The controls ------------------------------------------------------------
 *
 * One bar, three switches, the way call apps place them: the microphone on
 * the left, interrupt in the middle, deafen on the right. Interrupt does one
 * thing - cuts Studio off - so it is live only while Studio thinks or speaks;
 * a turn ends on its own when you stop talking. Mute closes the microphone;
 * deafen silences Studio's voice while the caption keeps going. Minimize
 * folds the call into a corner player clear of the side rail; Leave ends it;
 * Escape leaves from the full stage only.
 *
 * ---- Sound -------------------------------------------------------------------
 *
 * Joining and leaving, workers joining and leaving, and each switch play a
 * short cue (`callSounds.ts`). Interrupting does not.
 *
 * ---- Motion ------------------------------------------------------------------
 *
 * Entrance and exit are a whole surface changing, so they take
 * `DURATION.slow`. Inside, everything is crossfades and layout moves on the
 * session's state; the one continuous animation is the voice line (see `VoiceLine`).
 */

/** The voice's own name on the call. */
export const VOICE_NAME = 'Studio'

/** The line of state under Studio's name. */
const STAGE_LABEL = {
  connecting: 'Joining',
  listening: 'Listening',
  thinking: 'Thinking',
  speaking: 'Speaking',
  blocked: 'Microphone',
} as const

type Session = ReturnType<typeof useVoiceSession>

function stateLine(session: Session): string {
  if (session.holding === true) return 'Listening'
  return session.muted && session.stage === 'listening' ? 'Muted' : STAGE_LABEL[session.stage]
}

/** "An agent on the call", then "2 agents on the call": the helpers are agents to the person on the call. */
export function onTheCall(count: number): string {
  return count === 1 ? 'An agent on the call' : `${count} agents on the call`
}

/** Interrupt is live only while there is something to cut off. */
function canInterrupt(session: Session): boolean {
  return session.stage === 'thinking' || session.stage === 'speaking'
}

function MuteButton({ session, size }: { session: Session; size: 'md' | 'lg' }) {
  return (
    <IconButton
      label={session.muted ? 'Unmute microphone' : 'Mute microphone'}
      size={size}
      tone={session.muted ? 'solid' : 'quiet'}
      disabled={session.stage === 'blocked' || session.stage === 'connecting'}
      onClick={() => { playCue(session.muted ? 'unmute' : 'mute'); session.toggleMute() }}
    >
      {session.muted ? <Icons.muted size="md" /> : <Icons.dictate size="md" />}
    </IconButton>
  )
}

function DeafenButton({ session, size }: { session: Session; size: 'md' | 'lg' }) {
  return (
    <IconButton
      label={session.deafened ? 'Undeafen' : 'Deafen'}
      size={size}
      tone={session.deafened ? 'solid' : 'quiet'}
      onClick={() => { playCue(session.deafened ? 'undeafen' : 'deafen'); session.toggleDeafen() }}
    >
      {session.deafened ? <Icons.deafened size="md" /> : <Icons.listen size="md" />}
    </IconButton>
  )
}

export function VoiceModeOverlay({
  open,
  onClose,
  conversationId = null,
  fresh,
  minimized = false,
  onMinimize,
  onRestore,
  insetRight = 0,
}: {
  open: boolean
  onClose: () => void
  conversationId?: string | null
  fresh?: VoiceFreshChat
  /** Folded to the corner: the call keeps running while the page is used. */
  minimized?: boolean
  onMinimize?: () => void
  onRestore?: () => void
  /** How much of the window's right edge the side rail holds, so the corner player clears it. */
  insetRight?: number
}) {
  const screen = useScreenShare(conversationId, open)
  const session = useVoiceSession(open, conversationId, fresh, screen.onSpeechEnd, screen.onFinalUtterance)
  const call = useCallParticipants(conversationId, open)
  // A worker parks on a permission question the chat page would show; the
  // full stage covers that page, so the stage asks it itself. The id is the
  // parent's: voice workers raise their questions under it.
  const approvals = usePendingApprovals(conversationId ?? '', { enabled: open && conversationId !== null, active: open })

  // The call's own arrival and departure cues.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (open !== wasOpen.current) playCue(open ? 'join' : 'leave')
    wasOpen.current = open
  }, [open])

  // Escape leaves the mode from the full stage, including while the transport
  // is disabled — a mode you could not keyboard out of would be a trap with a
  // waveform in it. Not while folded: the page is in use then, and Escape
  // belongs to it.
  useEffect(() => {
    if (!open || minimized) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open, minimized, onClose])

  const asking = approvals.questions.length > 0
  const workers = call.unavailable ? [] : call.participants

  return (
    <AnimatePresence>
      {open && minimized ? (
        <motion.div
          key="mini"
          role="region"
          aria-label="Voice call"
          initial={{ opacity: 0, y: 12, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 12, scale: 0.96, transition: { duration: DURATION.fast, ease: EASE_OUT } }}
          transition={{ duration: DURATION.base, ease: EASE_OUT }}
          className="absolute bottom-4 z-50 flex w-[22rem] max-w-[calc(100%-2rem)] flex-col gap-2.5 rounded-2xl border border-border bg-surface-raised p-3 shadow-lg"
          style={{ right: insetRight + 16 }}
        >
          <div className="flex items-center gap-2.5">
            <span className="relative">
              <StudioAvatar size={36} busy={session.stage === 'thinking'} />
              <span
                aria-hidden
                className="absolute -left-0.5 -top-0.5 size-2.5 rounded-full border-2 border-surface-raised"
                style={{ background: `var(--voice-${session.stage})` }}
              />
            </span>
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-caption text-foreground">{VOICE_NAME} · {stateLine(session)}</span>
              <span className="truncate text-micro text-muted-foreground">
                {session.stage === 'blocked'
                  ? session.note || 'Microphone unavailable'
                  : session.stage === 'speaking' && session.spoken.length > 0
                    ? session.spoken.join('')
                    : workers.length > 0 ? onTheCall(workers.length) : 'Voice call'}
              </span>
            </div>
            {workers.length > 0 ? (
              <span className="flex -space-x-2">
                {workers.slice(0, 3).map((task) => {
                  const profile = call.profiles.get(task.id)
                  return profile === undefined ? null : <CritterAvatar key={task.id} profile={profile} mood={moodOf(task.stage)} size={24} />
                })}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-1">
            <MuteButton session={session} size="md" />
            <DeafenButton session={session} size="md" />
            <IconButton label="Stop talking" size="md" disabled={!canInterrupt(session)} onClick={session.interrupt}>
              <Icons.stop size="md" />
            </IconButton>
            {screen.available ? <ShareButton screen={screen} size="md" /> : null}
            <span className="flex-1" />
            <IconButton label="Expand voice mode" size="md" onClick={onRestore}>
              <Icons.openLarger size="md" />
            </IconButton>
            <Button variant="ghost" size="sm" onClick={onClose}>Leave</Button>
          </div>
          {asking ? (
            <button
              type="button"
              onClick={onRestore}
              className="rounded-lg bg-tint px-2.5 py-1.5 text-left text-caption text-foreground"
            >
              An agent is waiting for your approval. Review it
            </button>
          ) : null}
        </motion.div>
      ) : open ? (
        <motion.div
          key="stage"
          role="dialog"
          aria-modal
          aria-label="Voice mode"
          initial={{ opacity: 0, scale: 0.985 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.99, transition: { duration: DURATION.base, ease: EASE_OUT } }}
          transition={{ duration: DURATION.slow, ease: EASE_OUT }}
          className="absolute inset-0 z-50 flex flex-col bg-surface"
        >
          <header
            className="flex shrink-0 items-center justify-end gap-1"
            style={{ height: SHELL.topStrip.height, paddingInline: SHELL.topStrip.paddingInline }}
          >
            {/* What Studio can see, said where the eye starts. */}
            <AnimatePresence initial={false}>
              {screen.sharing || screen.note !== '' ? (
                <motion.span
                  key={screen.note === '' ? 'sharing' : 'note'}
                  role="status"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: DURATION.base, ease: EASE_OUT }}
                  className="mr-auto flex items-center gap-2 rounded-full bg-tint px-3 py-1 text-micro text-foreground"
                >
                  {screen.note === '' ? (
                    <>
                      <span aria-hidden className="size-1.5 rounded-full bg-[var(--voice-listening)] motion-safe:animate-pulse" />
                      {screen.showing ? 'Drawing on your screen' : 'Sharing your screen'}
                    </>
                  ) : screen.note}
                </motion.span>
              ) : null}
            </AnimatePresence>
            {onMinimize === undefined ? null : (
              <IconButton label="Minimize voice mode" size="md" onClick={onMinimize}>
                <Icons.minimize size="md" />
              </IconButton>
            )}
            {/* A word, not a mark: a cross dismisses a thing and an arrow
                points somewhere, while leaving a call is neither. */}
            <Button variant="ghost" size="sm" onClick={onClose}>Leave</Button>
          </header>

          {/* Blocked is the one state with no orb to watch and no transport
              to press, so it replaces the stage rather than decorating it. */}
          {session.stage === 'blocked' ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
              <p className="max-w-sm text-ui text-muted-foreground">
                {session.note || (session.denied
                  ? 'The microphone is blocked. Allow it for Studio in Windows privacy settings, then try again.'
                  : 'No microphone is available right now.')}
              </p>
              <Button variant="secondary" size="sm" onClick={() => void session.retry()}>
                Try again
              </Button>
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 overflow-y-auto px-6">
              {/* Who is talking, and how: Studio's chip - the same face the
                  corner player wears - over the live voice line. The words
                  under them are the point of the screen. */}
              <motion.div layout transition={{ duration: DURATION.base, ease: EASE_OUT }} className="flex flex-col items-center gap-3">
                {/* Studio stays centred; the agents' faces hang off its right
                    edge on the same line, one group with it (`ParticipantStack`). */}
                <div className="relative flex items-center gap-2.5">
                  {workers.length > 0 ? (
                    <div className="absolute left-full top-1/2 ml-4 flex -translate-y-1/2 items-center gap-3">
                      <span aria-hidden className="h-6 w-px bg-border" />
                      <ParticipantStack participants={workers} profiles={call.profiles} />
                      <span className="whitespace-nowrap text-micro text-muted-foreground">{onTheCall(workers.length)}</span>
                    </div>
                  ) : call.unavailable ? (
                    <span role="status" className="absolute left-full top-1/2 ml-4 -translate-y-1/2 whitespace-nowrap text-micro text-muted-foreground">Agent status unavailable</span>
                  ) : null}
                  <StudioAvatar size={32} busy={session.stage === 'thinking'} />
                  <div className="flex flex-col">
                    <span className="text-ui text-foreground">{VOICE_NAME}</span>
                    <span className="flex items-center gap-1.5 text-micro text-muted-foreground">
                      {stateLine(session)}
                      {session.stage === 'listening' && !session.muted ? <span className="tabular-nums">· {formatClock(session.elapsedMs)}</span> : null}
                      {session.deafened ? <span>· Deafened</span> : null}
                    </span>
                  </div>
                </div>
                <VoiceLine session={session} />
              </motion.div>

              {/* The words: two lines at a time (see `Caption`). Reserved
                  height so the room does not shift as replies come and go. */}
              <motion.div layout className="flex min-h-[5.5rem] w-full max-w-[34rem] items-start justify-center">
                <AnimatePresence initial={false} mode="wait">
                  {session.stage === 'speaking' && session.spoken.length > 0 ? (
                    <motion.div
                      key={`reply-${session.turn}`}
                      className="w-full"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: DURATION.base, ease: EASE_OUT }}
                    >
                      <Caption tokens={session.spoken} />
                    </motion.div>
                  ) : session.stage === 'listening' ? (
                    <motion.p
                      key={session.muted ? 'muted' : session.note === '' ? 'hint' : 'missed'}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: DURATION.base, ease: EASE_OUT }}
                      className="pt-2 text-center text-caption text-muted-foreground"
                    >
                      {session.muted
                        ? 'Your microphone is muted. Nothing is recorded until you unmute.'
                        : session.note !== ''
                          ? session.note
                          : 'Talk, then pause. The silence ends your turn.'}
                    </motion.p>
                  ) : null}
                </AnimatePresence>
              </motion.div>

            </div>
          )}

          <footer className="flex shrink-0 flex-col items-center gap-3 pb-7">
            {asking ? (
              <div className="w-full px-6" style={{ maxWidth: SHELL.measure }}>
                <ApprovalPrompt
                  // Keyed by the active question for the chat page's reason: a
                  // scope chosen for one question must not stay preselected.
                  key={approvals.questions[0]?.id}
                  questions={approvals.questions}
                  answeringId={approvals.answeringId}
                  onAnswer={approvals.answer}
                  // The stage does not know the chat's project, and "Always"
                  // would grant across one; the narrower ladder is the safe one.
                  hasProject={false}
                />
              </div>
            ) : null}
            {session.stage !== 'blocked' ? (
              <>
                {/* One bar holds the three switches, so they read as one
                    instrument rather than three circles floating under the
                    orb. Interrupt is the solid one in the middle. */}
                <div role="toolbar" aria-label="Call controls" className="flex items-center gap-3 rounded-full border border-border bg-surface-raised p-1.5 shadow-sm">
                  {/* The screen pair wraps the three call switches, one each
                      side, so interrupt stays the centre of the bar. */}
                  {screen.available ? <ShareButton screen={screen} size="lg" /> : null}
                  <MuteButton session={session} size="lg" />
                  <IconButton
                    // Says what it stops: Studio's voice. Tasks and the
                    // computer carry on; they have their own stops (D4).
                    label="Stop talking"
                    size="xl"
                    tone="solid"
                    disabled={!canInterrupt(session)}
                    onClick={session.interrupt}
                  >
                    <Icons.stop size="lg" />
                  </IconButton>
                  <DeafenButton session={session} size="lg" />
                  {screen.available ? <ShowMeButton screen={screen} size="lg" /> : null}
                </div>
                {/* The person's two other hands on the computer, quiet
                    until needed: words rather than marks, because pause and
                    stop of the computer must not be mistaken for the call's
                    own switches above them. */}
                <div className="flex items-center gap-1 text-micro text-muted-foreground/70">
                  {screen.available ? (
                    <>
                      <Button variant="ghost" size="xs" onClick={() => void screen.togglePause()}>
                        {screen.paused ? 'Resume computer' : 'Pause computer'}
                      </Button>
                      <Button variant="ghost" size="xs" onClick={() => void screen.stopComputer()}>Stop computer</Button>
                      <span aria-hidden className="px-1">·</span>
                    </>
                  ) : null}
                  <span>Esc to leave</span>
                </div>
              </>
            ) : null}
          </footer>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

/** How many bars the voice line draws. */
const BARS = 29

/**
 * The voice line: a row of thin bars in the state's colour, under Studio's
 * name, that says who is talking without standing in front of the words.
 *
 * Each state pairs a colour with a motion, because either alone is ambiguous:
 *
 *   connecting  grey, a slow shallow breath — waiting, not dead
 *   listening   blue, driven by the microphone; a silent room is a flat line
 *   thinking    amber, a slow pulse with nothing measured
 *   speaking    green, the syllable envelope
 *
 * The bars share one amount a frame and differ by a bell across the row and a
 * slow ripple travelling along it, so a level reads as a voice rather than a
 * meter. The frame loop writes heights to the DOM directly: it runs at
 * display rate and React state does not, so the stage never enters the
 * reconciler for one number a frame. Colour belongs to CSS, set once per stage.
 */
function VoiceLine({ session }: { session: Session }) {
  const live = useRef(session)
  live.current = session
  const bars = useRef<(HTMLSpanElement | null)[]>([])
  const level = useRef(0)
  const reduced = useMemo(() => prefersReducedMotion(), [])

  useEffect(() => session.mic.onFrame((value) => {
    level.current = value
  }), [session.mic])

  useEffect(() => {
    let frame = 0
    const startedAt = performance.now()

    const step = (now: number) => {
      const seconds = (now - startedAt) / 1000
      let amount: number
      switch (live.current.stage) {
        case 'listening':
          amount = live.current.muted ? 0 : level.current
          break
        case 'speaking':
          amount = reduced ? 0.32 : speakingEnvelope(seconds, live.current.turn)
          break
        case 'thinking':
          amount = reduced ? 0.05 : thinkingPulse(seconds) * 4
          break
        case 'blocked':
          amount = 0
          break
        default:
          amount = reduced ? 0.06 : idleBreath(seconds)
      }
      for (let index = 0; index < BARS; index++) {
        const bar = bars.current[index]
        if (bar === undefined || bar === null) continue
        const centre = 1 - Math.abs(index - (BARS - 1) / 2) / ((BARS - 1) / 2)
        const bell = 0.35 + 0.65 * Math.sin((centre * Math.PI) / 2)
        const ripple = reduced ? 1 : 0.7 + 0.3 * Math.sin(seconds * 5.2 - index * 0.55)
        // A silent line is a row of dots, not nothing: the call is still open.
        bar.style.height = `${(3 + Math.min(1, amount * 1.6) * bell * ripple * 25).toFixed(1)}px`
      }
      frame = requestAnimationFrame(step)
    }

    frame = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame)
    // The stage and turn are read per frame on purpose: restarting the loop
    // on every word would reset the clock the envelopes are driven by.
  }, [reduced])

  return (
    <div
      aria-hidden
      className="flex h-8 items-center gap-[3px]"
      style={{ color: `var(--voice-${session.stage})`, transition: `color ${DURATION.slow}s cubic-bezier(${EASE_OUT.join(',')})` }}
    >
      {Array.from({ length: BARS }, (_, index) => (
        <span
          key={index}
          ref={(node) => { bars.current[index] = node }}
          className="w-[3px] rounded-full"
          style={{ height: 3, background: 'currentColor' }}
        />
      ))}
    </div>
  )
}
