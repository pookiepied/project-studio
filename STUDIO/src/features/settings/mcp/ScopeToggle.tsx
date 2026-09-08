import { Segmented } from '@/components/primitives'
import type { McpScopeReading } from '@/platform/harness'

/**
 * The on / off / inherit control, shared by the screens that write a scope.
 *
 * Three answers, because the question really has three: this scope says on,
 * this scope says off, and this scope never answered, so a wider one decides.
 * The third is the whole mechanism - the spine treats absence as "no decision
 * here", which hands the question to the project and then to the user's
 * default - so a control that collapsed it to a checkbox would silently turn
 * "the default decides" into "off here", a change to what the model can reach
 * that nobody asked for. `null` goes out for Inherit, on purpose: it is what
 * the harness reads as "clear the decision", and sending `false` instead is
 * exactly the flattening this component exists to prevent.
 *
 * Inherit leads because it is the resting answer: a fresh project, a fresh
 * conversation, and nothing changed anywhere all read Inherit. Off and On
 * keep the order the global pane's switch uses, so the control looks like the
 * same control one question wider.
 */
export type ScopeChoice = 'inherit' | 'off' | 'on'

export function ScopeToggle({
  value,
  onChange,
  ariaLabel,
  layoutId,
}: {
  /** What this scope has stored: `null` is Inherit, not Off. */
  value: boolean | null
  onChange: (enabled: boolean | null) => void
  ariaLabel: string
  layoutId: string
}) {
  return (
    <Segmented<ScopeChoice>
      layoutId={layoutId}
      ariaLabel={ariaLabel}
      value={value === null ? 'inherit' : value ? 'on' : 'off'}
      onChange={(choice) => onChange(choice === 'inherit' ? null : choice === 'on')}
      options={[
        { id: 'inherit', label: 'Inherit' },
        { id: 'off', label: 'Off' },
        { id: 'on', label: 'On' },
      ]}
    />
  )
}

/**
 * What Inherit currently resolves to, in the words of the row.
 *
 * Shown when the control reads Inherit, so the row is honest about the effect
 * rather than only the setting: "Inherit" means something different in a
 * project whose default says on than in one where nothing decides, and the
 * person deciding is owed that difference. When the control reads On or Off
 * the control IS the effect, so there is nothing to say. `projectName` names
 * the project when the caller knows it, because "its project" beside a
 * conversation's own title is a pronoun looking for its noun.
 */
export function inheritSentence(
  reading: McpScopeReading,
  projectName?: string,
): string {
  const answer = reading.resolved ? 'on' : 'off'
  if (reading.decidedAt === undefined) {
    // With nothing decided anywhere the chain answers off, and the honest
    // sentence says that rather than dressing an absence up as a choice.
    return 'Nothing anywhere has decided, so it is off.'
  }
  switch (reading.decidedAt) {
    case 'global':
      return `Inherits the default, which has it ${answer}.`
    case 'project':
      return projectName === undefined
        ? `Inherits its project, which has it ${answer}.`
        : `Inherits ${projectName}, which has it ${answer}.`
    case 'conversation':
      return `Inherits the conversation, which has it ${answer}.`
  }
}
