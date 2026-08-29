import { useState } from 'react'
import { Icons, ProviderMark } from '@/components/icons'
import { Button, MenuItem, Popover } from '@/components/primitives'
import type { HarnessFailure, ProviderConnection } from '@/platform/harness'
import { Pane } from '@/features/settings/panes/Pane'
import { CredentialBadge } from './CredentialBadge'
import { ProbeLine } from './ProbeLine'
import { RemoveConnectionDialog } from './RemoveConnectionDialog'
import { AddConnectionDialog } from './AddConnectionDialog'
import { AddModelDialog } from './AddModelDialog'
import { ModelLibrary } from './ModelLibrary'
import { DefaultsSection } from './DefaultsSection'
import { useProviders, type Providers } from './useProviders'
import { cn } from '@/lib/cn'

/**
 * Providers and models: one pane over the one provider store.
 *
 * The pane is a shell around focused pieces - the hook owns every harness
 * call, the connection list owns rows, the model library owns per-connection
 * models, the defaults section owns the slots. Nothing here holds an API key:
 * the key lives in the add dialog's state for the length of one request and is
 * gone before the 201 is drawn.
 *
 * ---- Where the invocation is not -------------------------------------------
 *
 * Chat and web retrieval run end to end today. Images, video, speech,
 * transcription and embeddings are connectable, storable, listable and
 * choosable - the whole surface works - and the one honest sentence about
 * what cannot invoke them yet sits in the defaults row itself, which is
 * where the invocation would be reached from. See `DefaultsSection`.
 */
export function ProvidersPane() {
  const providers = useProviders()

  return (
    <Pane title="Providers" description="Where models come from, and what each can do.">
      <PaneBody providers={providers} />
    </Pane>
  )
}

function PaneBody({ providers }: { providers: Providers }) {
  const { view } = providers

  if (view.status === 'loading') {
    // No spinner. This is a request to a process on the same machine and the
    // honest expectation is that it is already done; a spinner that flashes
    // for 30ms is worse than a line of text that does not move.
    return <p className="py-4 text-ui text-muted-foreground">Reading connections...</p>
  }

  if (view.status === 'no-harness') return <NoHarness />

  if (view.status === 'failed') {
    return <LoadFailure error={view.error} onRetry={() => void providers.refresh()} />
  }

  return <ProviderList providers={providers} />
}

function NoHarness() {
  return (
    <>
      <p className="py-4 text-ui text-muted-foreground">
        No harness is connected, so there are no connections or models to list yet.
      </p>
      <p className="py-1 text-caption text-muted-foreground">
        Start Studio's harness to manage providers and pick models here.
      </p>
    </>
  )
}

function LoadFailure({ error, onRetry }: { error: HarnessFailure; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 py-4">
      <div>
        <p className="text-ui text-foreground">Could not read providers.</p>
        <p className="mt-0.5 text-caption text-muted-foreground">{error.message}</p>
      </div>
      <Button variant="secondary" size="sm" icon={<Icons.reload />} onClick={onRetry}>
        Try again
      </Button>
    </div>
  )
}

function ProviderList({ providers }: { providers: Providers }) {
  const { view } = providers
  if (view.status !== 'ready') return null

  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<ProviderConnection | null>(null)
  const [addingModel, setAddingModel] = useState<ProviderConnection | null>(null)

  return (
    <>
      {view.connections.length === 0 ? (
        <p className="py-4 text-ui text-muted-foreground">
          No connections yet. Add one to give Studio somewhere to send a request.
        </p>
      ) : (
        view.connections.map((record) => (
          <ConnectionRow
            key={record.id}
            record={record}
            providers={providers}
            onAddModel={() => setAddingModel(record)}
            onRemove={() => setRemoving(record)}
          />
        ))
      )}

      <div className="py-3">
        <Button variant="secondary" icon={<Icons.add />} onClick={() => setAdding(true)}>
          Add connection
        </Button>
      </div>

      <DefaultsSection
        defaults={view.defaults}
        connections={view.connections}
        models={view.models}
        onSet={(slot, ref) => void providers.setDefault(slot, ref)}
      />

      <AddConnectionDialog
        open={adding}
        onClose={() => setAdding(false)}
        onCreate={async (draft) => {
          const result = await providers.create(draft)
          return result.ok ? null : result.error
        }}
        onProbe={(id) => providers.probe(id)}
        library={view.library}
      />

      <RemoveConnectionDialog
        connection={removing}
        onClose={() => setRemoving(null)}
        onRemove={async (id) => {
          const result = await providers.remove(id)
          return result.ok ? null : result.error
        }}
      />

      <AddModelDialog
        open={addingModel !== null}
        onClose={() => setAddingModel(null)}
        connectionName={addingModel?.displayName ?? ''}
        onAdd={async (model) => {
          if (addingModel === null) return null
          const result = await providers.addManualModel(addingModel.id, model)
          return result.ok ? null : result.error
        }}
      />
    </>
  )
}

function ConnectionRow({
  record,
  providers,
  onAddModel,
  onRemove,
}: {
  record: ProviderConnection
  providers: Providers
  onAddModel: () => void
  onRemove: () => void
}) {
  const { view } = providers
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  if (view.status !== 'ready') return null

  const models = view.models.filter((model) => model.connectionId === record.id)
  const probe = providers.probes.get(record.id)
  const probing = probe?.status === 'probing'

  const kindLabel =
    record.kind === 'language' ? 'Language' : record.kind === 'media' ? 'Media' : 'Retrieval'

  return (
    <div className="py-3">
      <div className="flex items-start gap-2.5">
        {/* The mark is resolved from `catalogProvider`, the vendor whose model
            list applies - never from `id`, which is this connection's own name.
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
            <span className="ml-1.5 text-caption text-muted-foreground">{kindLabel}</span>
            {record.enabled ? null : (
              <span className="ml-1.5 text-caption text-muted-foreground">Disabled</span>
            )}
          </p>

          <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-caption text-muted-foreground">
            <span>
              {models.filter((model) => !model.hidden).length} of {models.length} models offered
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
              that eight seconds, so `busy` is not decoration here - without it
              the row looks broken for most of a working check. */}
          <Button
            variant="secondary"
            size="sm"
            busy={probing}
            onClick={() => void providers.probe(record.id)}
          >
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
              icon={record.enabled ? <Icons.disable /> : <Icons.check />}
              onSelect={() => {
                setMenuOpen(false)
                void providers.setEnabled(record.id, !record.enabled)
              }}
            >
              {record.enabled ? 'Disable' : 'Enable'}
            </MenuItem>

            <MenuItem
              icon={<Icons.add />}
              onSelect={() => {
                setMenuOpen(false)
                onAddModel()
              }}
            >
              Add model
            </MenuItem>

            <MenuItem
              onSelect={() => {
                setMenuOpen(false)
                setExpanded((value) => !value)
              }}
            >
              {expanded ? 'Hide models' : 'Show models'}
            </MenuItem>

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

      {expanded ? (
        <div className="mt-2 pl-9">
          <ModelLibrary
            connection={record}
            models={models}
            selectionBusy={false}
            onSelectionChange={(selectedIds) => void providers.setModelSelection(record.id, selectedIds)}
            onAddModel={onAddModel}
            onEditModel={(modelId, displayName, hidden) => {
              void providers.setModelOverride(
                record.id,
                modelId,
                hidden === undefined ? { displayName } : { displayName, hidden },
              )
            }}
            onRemoveModel={(modelId) => void providers.removeModel(record.id, modelId)}
          />
        </div>
      ) : null}
    </div>
  )
}
