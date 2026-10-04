import { JobsPanel } from '@/features/jobs/JobsPanel'
import { TasksSection } from '@/features/jobs/TasksSection'

/**
 * The conversation's background work: both kinds, one panel.
 *
 * The rail has always had this entry for the commands; agent tasks join it
 * as a section rather than as a second entry, because the two kinds are one
 * question to the person - "what is this conversation doing behind my back,
 * and how do I stop it" - and a tab per kind would make them hold that
 * question twice. The storage stays separate (the harness keeps the two
 * registries apart, and each kind's rows are its own); the consolidation is
 * at this panel, and nowhere else.
 *
 * Each section decides its own empty state. A conversation with commands
 * running but no tasks shows the commands at full width with no ghost
 * heading above them, and the reverse; a conversation with neither shows
 * the commands' own "nothing is running", which is the honest sentence for
 * the whole panel.
 */
export function BackgroundWorkPanel({ conversationId }: { conversationId: string }) {
  return (
    <div className="flex flex-col gap-5 pt-1">
      <TasksSection />
      <JobsPanel conversationId={conversationId} />
    </div>
  )
}
