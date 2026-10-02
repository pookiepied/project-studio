import { useState } from 'react'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import { Pane } from '@/features/settings/panes/Pane'
import { useGrants, type GrantsView } from '@/features/settings/permissions/useGrants'
import type { GrantRecord } from '@/platform/harness'

/**
 * The approvals already given.
 *
 * Every "always" and every "this conversation" the person has answered is a
 * row here, and the only action the page offers is taking one back. The
 * harness marks a revoked row rather than deleting it — what was once
 * approved stays reviewable — which is why the button says revoke and not
 * delete: the record survives the decision.
 */
export function PermissionsPane() {
  const grants = useGrants()
  const [note, setNote] = useState<string | null>(null)

  return (
    <Pane
      title="Permissions"
      description="What the agent has been allowed to do. An approval meant to outlast its call — always, or for that conversation — leaves a row here."
    >
      <div className="flex items-center justify-between py-3.5">
        <p className="text-ui text-muted-foreground">
          {grants.view.status === 'ready'
            ? `${grants.view.grants.length} standing ${grants.view.grants.length === 1 ? 'approval' : 'approvals'}`
            : ''}
        </p>
        <IconButton
          label="Refresh"
          onClick={() => void grants.refresh()}
          disabled={grants.refreshing}
        >
          <Icons.reload />
        </IconButton>
      </div>
      <Body
        view={grants.view}
        onRevoke={async (grant) => {
          const error = await grants.revoke(grant.id)
          setNote(error === null ? null : error.message)
        }}
      />
      {note !== null ? (
        <p role="alert" className="mt-3 text-caption text-danger">
          {note}
        </p>
      ) : null}
    </Pane>
  )
}

function Body({
  view,
  onRevoke,
}: {
  view: GrantsView
  onRevoke: (grant: GrantRecord) => void
}) {
  if (view.status === 'loading') return <Loading label="Loading approvals" />
  if (view.status === 'no-harness') {
    return (
      <StateNote
        title="The harness is not running."
        detail="Approvals are kept by the harness, so the list cannot be read until it starts."
      />
    )
  }
  if (view.status === 'failed') {
    return <StateNote title="The list could not be read." detail={view.error.message} />
  }

  if (view.grants.length === 0) {
    return (
      <p className="py-4 text-ui text-muted-foreground">
        Nothing has been approved yet. An approval appears here when it is meant to outlast the
        conversation it was given in.
      </p>
    )
  }

  return (
    <div className="flex flex-col divide-y">
      {view.grants.map((grant) => (
        <GrantRow key={grant.id} grant={grant} onRevoke={onRevoke} />
      ))}
    </div>
  )
}

function GrantRow({
  grant,
  onRevoke,
}: {
  grant: GrantRecord
  onRevoke: (grant: GrantRecord) => void
}) {
  const scope = grant.conversationId !== null ? 'This conversation' : 'Every conversation'
  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-ui text-foreground">
          <span className="font-mono">{grant.capabilityKey}</span>
        </p>
        <p className="mt-0.5 text-caption text-muted-foreground">
          {scope} · <span className="font-mono">{grant.agentId}</span>
          {grant.projectId !== null ? ` · ${grant.projectId}` : ''}
          {grant.resourcePattern !== null ? ` · narrowed to ${grant.resourcePattern}` : ''} ·
          granted {formatGranted(grant.grantedAt)}
        </p>
      </div>
      <div className="shrink-0">
        <IconButton label={`Revoke ${grant.capabilityKey}`} onClick={() => onRevoke(grant)}>
          <Icons.undo />
        </IconButton>
      </div>
    </div>
  )
}

function formatGranted(grantedAt: number): string {
  return new Date(grantedAt).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}
