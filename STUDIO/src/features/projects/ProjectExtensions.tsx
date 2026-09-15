import { useState, type ReactNode } from 'react'
import { Icons } from '@/components/icons'
import { extensionMark } from '@/components/icons/extensionMark'
import { Loading, StateNote } from '@/components/state'
import { ScopeToggle, inheritSentence } from '@/features/settings/mcp/ScopeToggle'
import { useMcpServers } from '@/features/settings/mcp/useMcpServers'
import { useSkills } from '@/features/settings/skills/useSkills'
import type { HarnessFailure, McpScopeReading } from '@/platform/harness'

/**
 * This project's extensions, and what it has decided about each.
 *
 * The screen the project scope was owed: the harness has written these
 * decisions since the spine existed, but nothing here called the route, so a
 * project's answer lived only in the database. Every row is this project's
 * own decision - on, off, or Inherit - and never the default itself, because
 * the global scope is only writable in Settings, where it belongs.
 *
 * ---- Why the rows carry Inherit ------------------------------------------
 *
 * Inherit is the most likely thing here to get quietly wrong. It reads as
 * plain absence in the store, next to Off, and a control that collapsed the
 * two would turn "the default decides" into "off for this project" - a
 * change to what the project's conversations can reach that nobody asked
 * for. So the third value is a real option, and when it is the one showing,
 * the row also says what it resolves to right now: Inherit means something
 * different under a default that says on than under one where nothing
 * decides, and the row is the only place that difference is visible.
 *
 * ---- When a change arrives -----------------------------------------------
 *
 * A conversation that is already open applies the new decision the next time
 * it sends; the capabilities note it was given at its start does not change,
 * so the model meets a later addition when it looks, or in a new conversation.
 * That sentence sits under the list because it is the part of the trade the
 * switch itself cannot say: the person toggling here is changing what their
 * project's conversations can reach, and the one conversation they may be
 * picturing does not reshuffle itself.
 *
 * ---- Two kinds, one row ---------------------------------------------------
 *
 * Servers and skills are the two kinds of extension a project decides about,
 * and they are decided the same way: the same three answers, the same
 * readings, the same route shape one mount over. So they share the row and
 * the toggle, and differ only in the group they are listed under and the
 * hook that reads them.
 */
export function ProjectExtensions({ projectId }: { projectId: string }) {
  const servers = useMcpServers({ projectId })
  const skills = useSkills({ projectId })
  // A refused write leaves the list, but the person must not click again
  // into silence: the refusal renders where the click happened, once, until
  // the next attempt replaces it.
  const [lastError, setLastError] = useState<HarnessFailure | null>(null)

  const serverView = servers.view
  const skillView = skills.view

  if (serverView.status === 'loading' || skillView.status === 'loading') {
    return <Loading label="Loading extensions" />
  }

  if (serverView.status === 'no-harness' || skillView.status === 'no-harness') {
    return (
      <StateNote
        title="The harness is not running."
        detail="Extensions live in the harness, so the list cannot be read until it starts."
      />
    )
  }

  if (serverView.status === 'failed') {
    return <StateNote title="The list could not be read." detail={serverView.error.message} />
  }
  if (skillView.status === 'failed') {
    return <StateNote title="The list could not be read." detail={skillView.error.message} />
  }

  return (
    <div>
      <Group label="MCP servers">
        {serverView.servers.length === 0 ? (
          <StateNote
            title="No MCP servers installed."
            detail="Add one under Settings, Extensions. It starts undecided everywhere, including here."
          />
        ) : (
          serverView.servers.map((server) => (
            <ScopeRow
              key={server.id}
              id={`server-${server.id}`}
              title={server.title}
              description={server.description}
              mark={extensionMark(server)}
              reading={server.project}
              onDecide={(enabled) => {
                // Seed the switch locally so it moves on the click, then let
                // the hook's re-read be the authority - the same bargain the
                // global pane's rows make, and for the same reason: the harness
                // is what knows what a write produced.
                void servers.setEnabled(server.id, enabled).then(setLastError)
              }}
            />
          ))
        )}
      </Group>
      <Group label="Skills">
        {skillView.listing.skills.length === 0 ? (
          <StateNote
            title="No skills installed."
            detail="Put a skill folder in place under Settings, Skills. It starts undecided everywhere, including here."
          />
        ) : (
          skillView.listing.skills.map((skill) => (
            <ScopeRow
              key={skill.id}
              id={`skill-${skill.id}`}
              title={skill.title}
              description={skill.description}
              mark={<Icons.skill />}
              reading={skill.project}
              onDecide={(enabled) => {
                void skills.setEnabled(skill.id, enabled).then(setLastError)
              }}
            />
          ))
        )}
      </Group>
      {lastError === null ? null : (
        <StateNote title="The harness refused that change." detail={lastError.message} />
      )}
      <p className="mt-3 text-caption text-muted-foreground">
        A conversation that is already open applies the new decision the next time it sends. The
        capabilities note it was given at its start does not change, so the model meets a later
        addition when it looks, or in a new conversation.
      </p>
    </div>
  )
}

function Group({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="mb-4">
      <p className="mb-1.5 text-caption text-muted-foreground">{label}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  )
}

/**
 * One project's decision about one extension.
 *
 * The row reads the decision from the harness's reading, not from whether
 * anything is connected: a project can have said off while the process still
 * runs for another project, and a switch that inferred its state would show
 * the wrong answer in exactly that case.
 */
function ScopeRow({
  id,
  title,
  description,
  mark,
  reading,
  onDecide,
}: {
  /** Unique across both groups, for the toggle's layout identity. */
  id: string
  title: string
  description: string
  mark: ReactNode
  /** This scope's own reading, when the harness supplied one. */
  reading?: McpScopeReading
  onDecide: (enabled: boolean | null) => void
}) {
  // Held so the switch moves the moment it is clicked, rather than waiting
  // for the write and the re-read. Seeded once, like the global pane's rows:
  // the harness remains the authority, this only removes the pause.
  const [decision, setDecision] = useState(reading?.decision ?? null)

  return (
    <div className="flex items-center gap-2 rounded-md border px-2.5 py-1.5">
      <span className="shrink-0">{mark}</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui text-foreground">{title}</p>
        {description === '' ? null : (
          <p className="mt-0.5 truncate text-caption text-muted-foreground">{description}</p>
        )}
        {/* The effect, while the switch reads Inherit. When it reads On or
            Off the control IS the effect, and the row says nothing - the
            same rule the inherit note follows everywhere. */}
        {reading !== undefined && decision === null ? (
          <p className="mt-0.5 truncate text-caption text-muted-foreground">
            {inheritSentence(reading)}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">
        <ScopeToggle
          value={decision}
          onChange={(enabled) => {
            setDecision(enabled)
            onDecide(enabled)
          }}
          ariaLabel={`${title} in this project`}
          layoutId={`project-extension-${id}`}
        />
      </div>
    </div>
  )
}
