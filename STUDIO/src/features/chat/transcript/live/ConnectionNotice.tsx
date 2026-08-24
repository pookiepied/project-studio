import { Button } from '@/components/primitives'
import type { ConversationPhase } from '@/features/chat/useConversation'

/**
 * What the connection itself wants to say, between the transcript and the
 * composer.
 *
 * Only the states that need words get them. `live`, `idle` and `streaming`
 * render nothing -- a connected conversation narrates itself through its
 * content, and a permanent "connected" strip is exactly the kind of chrome
 * that teaches people to stop reading. The four that remain are states where
 * silence would be read as something else: no harness, a harness coming up,
 * a read that broke, or a turn that failed.
 */
export function ConnectionNotice({
  phase,
  onResume,
}: {
  phase: ConversationPhase
  onResume: () => void
}) {
  switch (phase.status) {
    case 'no-harness':
      return (
        <Notice>
          The harness is not running, so there is nothing to talk to yet. Start it from the
          status bar and this conversation will attach on its own.
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
    case 'run-failed':
      return (
        <Notice>
          {phase.message}
          <Resume
            onResume={onResume}
            label={phase.outcome === 'aborted' ? 'Back to the conversation' : 'See what happened'}
          />
        </Notice>
      )
    default:
      return null
  }
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
