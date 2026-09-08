import { useState } from 'react'
import { Icons } from '@/components/icons'
import { StateNote } from '@/components/state'
import { PlaceholderText } from '@/components/placeholder'
import { ScopeToggle, inheritSentence } from '@/features/settings/mcp/ScopeToggle'
import { useMcpServers } from '@/features/settings/mcp/useMcpServers'
import type { HarnessFailure, McpScopeReading, McpServerRecord } from '@/platform/harness'

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
 */
export function ProjectExtensions({ projectId }: { projectId: string }) {
  const servers = useMcpServers({ projectId })
  // A refused write leaves the list, but the person must not click again
  // into silence: the refusal renders where the click happened, once, until
  // the next attempt replaces it.
  const [lastError, setLastError] = useState<HarnessFailure | null>(null)

  const { view } = servers

  if (view.status === 'loading') {
    return (
      <div role="status" aria-label="Loading extensions" className="flex flex-col gap-2 py-1 text-ui">
        {['58%', '41%'].map((width) => (
          <PlaceholderText key={width} className={width} />
        ))}
      </div>
    )
  }

  if (view.status === 'no-harness') {
    return (
      <StateNote
        title="The harness is not running."
        detail="Extensions live in the harness, so the list cannot be read until it starts."
      />
    )
  }

  if (view.status === 'failed') {
    return <StateNote title="The list could not be read." detail={view.error.message} />
  }

  if (view.servers.length === 0) {
    return (
      <StateNote
        title="No extensions installed."
        detail="Add one under Settings, Extensions. It starts undecided everywhere, including here."
      />
    )
  }

  return (
    <div>
      <div className="flex flex-col gap-1">
        {view.servers.map((server) => (
          <ScopeRow
            key={server.id}
            server={server}
            reading={server.project}
            onDecide={(enabled) => {
              // Seed the switch locally so it moves on the click, then let
              // the hook's re-read be the authority - the same bargain the
              // global pane's rows make, and for the same reason: the harness
              // is what knows what a write produced.
              void servers.setEnabled(server.id, enabled).then(setLastError)
            }}
          />
        ))}
      </div>
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

/**
 * One project's decision about one extension.
 *
 * The row reads the decision from the harness's reading, not from whether
 * anything is connected: a project can have said off while the process still
 * runs for another project, and a switch that inferred its state would show
 * the wrong answer in exactly that case.
 */
function ScopeRow({
  server,
  reading,
  onDecide,
}: {
  server: McpServerRecord
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
      <span className="shrink-0">
        <Icons.mcp />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-ui text-foreground">{server.title}</p>
        {server.description === '' ? null : (
          <p className="mt-0.5 truncate text-caption text-muted-foreground">
            {server.description}
          </p>
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
          ariaLabel={`${server.title} in this project`}
          layoutId={`project-extension-${server.id}`}
        />
      </div>
    </div>
  )
}
