import { useState } from 'react'

import { Button } from '@/components/primitives'
import { harnessFailureReason, startHarness } from '@/platform/harness'
import {
  classifyFailureKind,
  failureRemedy,
} from '@/features/chat/transcript/failure-kind'
import type { ConversationPhase } from '@/features/chat/connection/useConversation'
import type { SeamFailure } from '@/platform/harness'

/**
 * What the connection itself wants to say, between the transcript and the
 * composer.
 *
 * Only the states that need words get them. `live`, `idle` and `streaming`
 * render nothing — a connected conversation narrates itself through its
 * content, and a permanent "connected" strip is exactly the kind of chrome
 * that teaches people to stop reading. The four that remain are states where
 * silence would be read as something else: no harness, a harness coming up,
 * a read that broke, or a turn that failed.
 *
 * `refused` is a submission failure — a POST the harness would not take.
 * It is not a phase (a send can be refused while an earlier turn streams),
 * but it lands here because this is where connection trouble speaks: every
 * other cause of "I pressed send and nothing happened" already had its
 * sentence in this spot. Each cause names what a person can do about it,
 * because they are not the same sentence — a missing provider connection,
 * a stale admission credential and a dead harness have different remedies,
 * and only the refusal's own words distinguish them.
 */
export function ConnectionNotice({
  phase,
  onResume,
  refused,
  onDismissRefusal,
}: {
  phase: ConversationPhase
  onResume: () => void
  refused?: SeamFailure | null
  onDismissRefusal?: () => void
}) {
  return (
    <>
      {refused !== null && refused !== undefined ? (
        <SendRefusal failure={refused} onDismiss={onDismissRefusal} />
      ) : null}
      <PhaseNotice phase={phase} onResume={onResume} />
    </>
  )
}

function PhaseNotice({ phase, onResume }: { phase: ConversationPhase; onResume: () => void }) {
  switch (phase.status) {
    case 'no-harness':
      return (
        <Notice>
          The harness is not running, so there is nothing to talk to yet.
          <StartHarness onStarted={onResume} />
        </Notice>
      )
    case 'harness-starting':
      return <Notice>Starting the harness…</Notice>
    case 'attaching':
      return <Notice>Reaching the conversation…</Notice>
    case 'interrupted':
      return (
        <Notice>
          {phase.reason}
          {/* The offset was retained across the break (ADR 0045): resuming
              re-reads from exactly where this window stopped, so nothing the
              run produced in the meantime is lost or replayed twice. */}
          <Resume onResume={onResume} label="Reattach" />
        </Notice>
      )
    case 'run-failed': {
      const remedy =
        phase.outcome === 'aborted'
          ? null
          : failureRemedy(classifyFailureKind(phase.detail))
      return (
        <Notice>
          {phase.message}
          {phase.detail !== null ? (
            <div className="mt-0.5 max-w-[60ch] break-words text-muted-foreground/80">
              {phase.detail}
            </div>
          ) : null}
          {remedy !== null ? (
            <div className="max-w-[60ch] break-words text-muted-foreground/80">{remedy}</div>
          ) : null}
          <Resume
            onResume={onResume}
            label={phase.outcome === 'aborted' ? 'Back to the conversation' : 'See what happened'}
          />
        </Notice>
      )
    }
    default:
      return null
  }
}

/**
 * The sentence for a refused send, per cause.
 *
 * `unreachable` gets the careful one: a submission whose acknowledgement was
 * lost MAY have been admitted — an identical resend would be a second turn
 * (the harness deduplicates nothing), so the honest instruction is to look
 * before re-sending, not to promise the message never arrived.
 */
function refusalCopy(failure: SeamFailure): string {
  switch (failure.kind) {
    case 'no-harness':
      return 'The message was not sent: there is no harness running to receive it. Start it below, then send again.'
    case 'refused':
      return `The harness refused this message (${failure.status}): ${failure.message} Fix what it names, then send again.`
    case 'unreachable':
      return 'The harness stopped answering while the message was being sent, so it may or may not have arrived. Check the transcript before sending it again.'
    case 'rejected':
      return `The message could not be sent: ${failure.message}`
    case 'broken':
      return `The connection broke while sending: ${failure.message} Sending again is safe.`
    case 'malformed':
      return 'The harness answered the send in a shape Studio could not read, so the message may or may not have arrived. Check the transcript before sending it again.'
  }
}

/**
 * A send the harness would not take, wherever it was sent from.
 *
 * Exported because home and a project page start conversations too, and a
 * first send that was refused needs the same sentence there — with no phase
 * beside it, because those pages have no connection of their own to narrate.
 */
export function SendRefusal({
  failure,
  onDismiss,
}: {
  failure: SeamFailure
  onDismiss?: () => void
}) {
  return (
    <Notice>
      <span className="text-danger">{refusalCopy(failure)}</span>
      {onDismiss !== undefined ? (
        <div className="mt-0.5">
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        </div>
      ) : null}
    </Notice>
  )
}

/**
 * The one control in the app that can start the harness.
 *
 * Here rather than in a status bar because this is where the absence is
 * already being reported, and a remedy belongs beside the sentence that names
 * the problem. The copy used to point at a status bar; there is no status bar,
 * and `restart_harness` — a Tauri command since the supervisor landed — had
 * never been called from the webview at all. So a harness that failed to come
 * up left the app permanently unable to send, with instructions that could not
 * be followed.
 *
 * A start it refuses says so and stays put, rather than clearing itself: the
 * supervisor keeps the reason, and the refused press fetches it through
 * `harnessFailureReason` and prints it verbatim under the control. That fetch
 * is what turned the promise the docblock below always made -- "the phase this
 * notice renders will carry it on the next look" -- into something a person
 * can actually read; before it, a refused start was visually identical to
 * never having pressed. Pressing again is safe -- the supervisor is
 * single-flight, so a second press joins the first start rather than launching
 * a second harness.
 */
function StartHarness({ onStarted }: { onStarted: () => void }) {
  const [starting, setStarting] = useState(false)
  const [reason, setReason] = useState<string | null>(null)

  return (
    <div className="mt-0.5">
      <Button
        variant="ghost"
        size="sm"
        disabled={starting}
        onClick={() => {
          setStarting(true)
          setReason(null)
          void startHarness()
            .then((up) => {
              // Only on success. Reattaching to a harness that did not come up
              // would replace the reason with a generic reaching-out message.
              if (up) {
                onStarted()
                return undefined
              }
              return harnessFailureReason().then((found) => {
                setReason(found)
              })
            })
            .finally(() => {
              setStarting(false)
            })
        }}
      >
        {starting ? 'Starting the harness…' : 'Start the harness'}
      </Button>
      {reason !== null ? (
        // Verbatim from the supervisor, redacted at its source.
        <div className="mt-0.5 max-w-[60ch] break-words text-left text-caption text-muted-foreground/80">
          {reason}
        </div>
      ) : null}
    </div>
  )
}

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 py-2 text-center text-caption text-muted-foreground">
      <div className="max-w-[60ch]">{children}</div>
    </div>
  )
}

function Resume({ onResume, label }: { onResume: () => void; label: string }) {
  return (
    <div className="mt-0.5">
      <Button variant="ghost" size="sm" onClick={onResume}>
        {label}
      </Button>
    </div>
  )
}
