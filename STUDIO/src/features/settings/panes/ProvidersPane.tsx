import { useState } from 'react'
import { Icons, ProviderMark } from '@/components/icons'
import { Button, MenuItem, MenuSeparator, Popover } from '@/components/primitives'
import { MODELS, PROVIDERS } from '@/domain/models/catalog'
import type { HarnessFailure, ProviderConnection, ProviderModel } from '@/platform/harness'
import { Pane } from '@/features/settings/panes/Pane'
import {
  AddConnectionDialog,
  CredentialBadge,
  ProbeLine,
  RemoveConnectionDialog,
  useConnections,
  type Connections,
  type ProbeState,
} from '@/features/settings/connections'
import { cn } from '@/lib/cn'

/**
 * Providers and models, from the harness.
 *
 * ---- The API key decision, which changed ----------------------------------
 *
 * This pane used to say, in a docblock right here, that it deliberately asked
 * for no API key: "keys belong in the OS credential store, which is the
 * harness's job, and a text input in a settings pane is exactly the wrong
 * place to start that habit."
 *
 * That reasoning was correct and its premise is now false. It was written when
 * there was nowhere safe to send a key — no transport, no harness, and the
 * only persistent surface the webview had was a plaintext JSON file. There is
 * somewhere safe now: the harness accepts a key in the body of a create,
 * strips it into the OS credential store, and files the connection record
 * without it. The record it returns cannot carry a key in either direction, by
 * contract, so there is no path back out.
 *
 * So the pane asks for one, and the whole of the old caution survives as the
 * rule the dialog is built around: the key lives in that component's state and
 * nowhere else, for as long as it takes to submit one request. See
 * `AddConnectionDialog` — the reasoning that matters now lives beside the
 * field it governs rather than up here.
 *
 * ---- Two lists, one pane ---------------------------------------------------
 *
 * With no harness configured this shows the built-in catalog exactly as it
 * always has, with one quiet line saying so. That is not a degraded mode and
 * must not be drawn as one: running Studio with no harness is the shipped
 * behaviour and a reasonable way to use it. The rows are plainly inert —
 * no credential badge, no controls — which is what tells them apart from real
 * connections without a legend anywhere on the page.
 */
export function ProvidersPane() {
  const connections = useConnections()

  return (
    <Pane title="Providers" description="Where models come from.">
      <PaneBody connections={connections} />
    </Pane>
  )
}

function PaneBody({ connections }: { connections: Connections }) {
  const { view } = connections

  if (view.status === 'loading') {
    // No spinner. This is a request to a process on the same machine and the
    // honest expectation is that it is already done; a spinner that flashes
    // for 30ms is worse than a line of text that does not move.
    return <p className="py-4 text-ui text-muted-foreground">Reading connections...</p>
  }

  if (view.status === 'no-harness') return <BuiltInCatalog />

  if (view.status === 'failed') {
    return <LoadFailure error={view.error} onRetry={() => void connections.refresh()} />
  }

  return (
    <ConnectionList
      connections={connections}
      records={view.connections}
      models={view.models}
    />
  )
}

/**
 * The offline catalog: six vendors and their model counts, from fixtures.
 *
 * Kept because it is the honest answer to "what can this app talk to" when
 * nothing is running behind it, and because it is what every other part of the
 * app is still driven by. It gains no controls — there is nothing to enable,
 * nothing to probe, and no credential to report — and that inertness is the
 * visual difference from a real connection.
 */
function BuiltInCatalog() {
  return (
    <>
      {PROVIDERS.map((provider) => {
        const count = MODELS.filter((model) => model.providerId === provider.id).length
        return (
          <div key={provider.id} className="flex items-center gap-2.5 py-3">
            <span className="flex size-7 items-center justify-center rounded-md bg-selected text-foreground">
              <ProviderMark provider={provider.id} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-ui text-foreground">{provider.name}</p>
              <p className="text-caption text-muted-foreground">
                Built in - {count} {count === 1 ? 'model' : 'models'}
              </p>
            </div>
          </div>
        )
      })}

      <p className="py-3 text-caption text-muted-foreground">
        These are the built-in defaults. No harness is connected, so there is nothing to add or
        change here yet.
      </p>
    </>
  )
}

/**
 * The harness answered, and what it said was no.
 *
 * The client's failure kinds are already the three distinctions a person can
 * act on, so the message is shown as written and only the retry is added. A
 * second sentence explaining what "not reachable" means would be this pane
 * guessing at a cause the transport already reported.
 */
function LoadFailure({ error, onRetry }: { error: HarnessFailure; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-4">
      <div>
        <p className="text-ui text-foreground">Could not read connections.</p>
        <p className="mt-0.5 text-caption text-muted-foreground">{error.message}</p>
      </div>
      <Button variant="secondary" size="sm" icon={<Icons.reload />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function ConnectionList({
  connections,
  records,
  models,
}: {
  connections: Connections
  records: readonly ProviderConnection[]
  models: readonly ProviderModel[]
}) {
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<ProviderConnection | null>(null)

  return (
    <>
      {records.length === 0 ? (
        <p className="py-4 text-ui text-muted-foreground">
          No connections yet. Add one to give Studio somewhere to send a request.
        </p>
      ) : (
        records.map((record) => (
          <ConnectionRow
            key={record.id}
            record={record}
            modelCount={models.filter((model) => model.connectionId === record.id).length}
            probe={connections.probes.get(record.id)}
            onProbe={() => void connections.probe(record.id)}
            onToggle={() => void connections.setEnabled(record.id, !record.enabled)}
            onRemove={() => setRemoving(record)}
          />
        ))
      )}

      <div className="py-3">
        <Button variant="secondary" icon={<Icons.add />} onClick={() => setAdding(true)}>
          Add connection
        </Button>
      </div>

      <AddConnectionDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreate={async (draft) => {
          const result = await connections.create(draft)
          return result.ok ? null : result.error
        }}
      />

      <RemoveConnectionDialog
        connection={removing}
        onClose={() => setRemoving(null)}
        onRemove={async (id) => {
          const result = await connections.remove(id)
          return result.ok ? null : result.error
        }}
      />
    </>
  )
}

function ConnectionRow({
  record,
  modelCount,
  probe,
  onProbe,
  onToggle,
  onRemove,
}: {
  record: ProviderConnection
  modelCount: number
  probe: ProbeState | undefined
  onProbe: () => void
  onToggle: () => void
  onRemove: () => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const probing = probe?.status === 'probing'

  return (
    <div className="flex items-start gap-2.5 py-3">
      {/* The mark is resolved from `catalogProvider`, the vendor whose model
          list applies — never from `id`, which is this connection's own name.
          A vendor the app has no drawing for falls back to the custom mark,
          which is the normal case for a self-hosted endpoint. */}
      <span
        className={cn(
          'flex size-7 shrink-0 items-center justify-center rounded-md bg-selected',
          // A disabled connection is dimmed rather than removed or struck
          // through: it still exists, still holds its key, and is one menu
          // click from working again.
          record.enabled ? 'text-foreground' : 'text-muted-foreground/60',
        )}
      >
        <ProviderMark provider={record.catalogProvider ?? ''} />
      </span>

      <div className="min-w-0 flex-1">
        <p className={cn('text-ui', record.enabled ? 'text-foreground' : 'text-muted-foreground')}>
          {record.displayName}
          {record.enabled ? null : (
            <span className="ml-1.5 text-caption text-muted-foreground">Disabled</span>
          )}
        </p>

        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
          <span>
            {modelCount} {modelCount === 1 ? 'model' : 'models'}
          </span>
          <span aria-hidden>-</span>
          <CredentialBadge status={record.credential} />
        </p>

        {probe ? (
          <p className="mt-0.5">
            <ProbeLine state={probe} />
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {/* The probe reaches the provider's own endpoint and the harness gives
            that eight seconds, so `busy` is not decoration here — without it
            the row looks broken for most of a working check. */}
        <Button variant="secondary" size="sm" busy={probing} onClick={onProbe}>
          {probe === undefined ? 'Check' : 'Check again'}
        </Button>

        <Popover
          open={menuOpen}
          onOpenChange={setMenuOpen}
          side="bottom"
          align="end"
          trigger={
            <button
              type="button"
              aria-label={`${record.displayName} options`}
              onClick={() => setMenuOpen((open) => !open)}
              className="flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-tint"
            >
              <Icons.more />
            </button>
          }
        >
          <MenuItem
            icon={record.enabled ? <Icons.permissionManual /> : <Icons.check />}
            onSelect={() => {
              setMenuOpen(false)
              onToggle()
            }}
          >
            {record.enabled ? 'Disable' : 'Enable'}
          </MenuItem>

          <MenuSeparator />
          <MenuItem
            icon={<Icons.delete />}
            destructive
            onSelect={() => {
              setMenuOpen(false)
              onRemove()
            }}
          >
            Remove
          </MenuItem>
        </Popover>
      </div>
    </div>
  )
}
