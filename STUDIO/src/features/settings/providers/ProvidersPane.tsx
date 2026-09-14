import { useState } from 'react'
import { Icons } from '@/components/icons'
import { ProviderMark } from '@/features/models'
import { Button, MenuItem, Popover } from '@/components/primitives'
import { Loading, StateNote } from '@/components/state'
import {
  capabilityServesKind,
  connectionKinds,
  servesKindOf,
  SLOTS_BY_KIND,
  type ProviderConnection,
  type ProviderKind,
  type ProviderModel,
} from '@/platform/harness'
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

const KIND_LABELS: Readonly<Record<ProviderKind, string>> = {
  language: 'Language',
  media: 'Media',
  retrieval: 'Retrieval',
}

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
/** The three pages, one per kind: what each is called and what it is for. */
const PAGES: Readonly<Record<ProviderKind, { title: string; description: string }>> = {
  language: { title: 'Models', description: 'The models that answer in text, and where they come from.' },
  media: {
    title: 'Media',
    description: 'Images, video, speech and transcription: which provider makes each, and with which model.',
  },
  retrieval: {
    title: 'Tools',
    description: 'Web search and page reading: which service answers, and which is tried next.',
  },
}

/**
 * What a page calls the things a connection offers. Language and media
 * entries are models; a Tools entry is a service - Brave Search is not a
 * model, and a person reading "models offered" under it would be right to
 * object.
 */
const NOUN_BY_KIND: Readonly<Record<ProviderKind, string>> = {
  language: 'model',
  media: 'model',
  retrieval: 'service',
}

export function ProvidersPane({ kind }: { kind: ProviderKind }) {
  const providers = useProviders()
  const page = PAGES[kind]

  return (
    <Pane title={page.title} description={page.description}>
      <PaneBody providers={providers} kind={kind} />
    </Pane>
  )
}

function PaneBody({ providers, kind }: { providers: Providers; kind: ProviderKind }) {
  const { view } = providers

  if (view.status === 'loading') {
    return <Loading label="Loading connections" />
  }

  if (view.status === 'no-harness') return <NoHarness />

  if (view.status === 'failed') {
    return (
      <StateNote
        title="Could not read providers."
        detail={view.error.message}
        action={
          <Button variant="secondary" size="sm" icon={<Icons.reload />} onClick={() => void providers.refresh()}>
            Try again
          </Button>
        }
      />
    )
  }

  return <ProviderList providers={providers} kind={kind} />
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


function ProviderList({ providers, kind }: { providers: Providers; kind: ProviderKind }) {
  const { view } = providers
  // The state comes first, ahead of the guard, the way `ConnectionRow` below
  // already does it. Hooks after a conditional return are only safe while the
  // condition never changes under a mounted component: today the pane renders
  // this one only once the view is ready, so the guard never fires and the
  // hooks always run. That is a fact about the caller, not about this
  // component, and the day it stops being true React counts a different
  // number of hooks between two renders and takes the tree down with it.
  const [adding, setAdding] = useState(false)
  const [removing, setRemoving] = useState<ProviderConnection | null>(null)
  const [addingModel, setAddingModel] = useState<ProviderConnection | null>(null)
  if (view.status !== 'ready') return null

  // This page's slice: the connections that serve its kind, the models of
  // that kind on them, the vendors that could serve it, and its slots. A
  // connection that serves several kinds shows on each page with that
  // page's models, and is one connection everywhere - one key, entered once.
  // A model answers the kind question once per kind too: a joined row that
  // both chats and paints shows on both pages, which is what
  // `capabilityServesKind` is for.
  const connections = view.connections.filter((record) => servesKindOf(record, kind))
  const models = view.models.filter((model) => capabilityServesKind(model.capability, kind))
  const library = view.library.filter((entry) => entry.serves[kind] !== undefined)
  const slots = SLOTS_BY_KIND[kind]
  const noun = NOUN_BY_KIND[kind]

  return (
    <>
      {connections.length === 0 ? (
        <p className="py-4 text-ui text-muted-foreground">
          {kind === 'language'
            ? 'No connections yet. Add one to give Studio somewhere to send a request.'
            : kind === 'media'
              ? 'No provider serves media yet. Add one, and the image, video and voice features find it here.'
              : 'No provider serves search or page reading yet. Add one, and the web tools use it.'}
        </p>
      ) : (
        connections.map((record) => (
          <ConnectionRow
            key={record.id}
            record={record}
            models={models}
            noun={noun}
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
        slots={slots}
        noun={noun}
        defaults={view.defaults}
        connections={connections}
        models={models}
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
        library={library}
        customEndpoint={kind === 'language'}
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
  models: pageModels,
  noun,
  providers,
  onAddModel,
  onRemove,
}: {
  record: ProviderConnection
  /** This page's models, from which the row takes its own connection's. */
  models: readonly ProviderModel[]
  /** What this page calls one of them: "model" or "service". */
  noun: string
  providers: Providers
  onAddModel: () => void
  onRemove: () => void
}) {
  const { view } = providers
  const [menuOpen, setMenuOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  if (view.status !== 'ready') return null

  const models = pageModels.filter((model) => model.connectionId === record.id)
  const probe = providers.probes.get(record.id)
  const probing = probe?.status === 'probing'

  // Every kind the one key serves, in the contract's order: "Language, Media"
  // for an OpenAI connection, "Retrieval" for Tavily.
  const kindLabel = connectionKinds(record)
    .map((kind) => KIND_LABELS[kind])
    .join(', ')

  return (
    <div className="py-3">
      <div className="flex items-start gap-2.5">
        {/* The mark is resolved from `catalogProvider`, the vendor whose model
            list applies - never from `id`, which is this connection's own name.
            A vendor with no logo falls back to its initial, which is the normal
            case for a self-hosted endpoint.

            This row used to wrap the mark in a tile of its own. The mark brings
            its own now, so the wrapper would have been a tile inside a tile;
            what is left here is the colour the mark inherits. A disabled
            connection is dimmed rather than removed or struck through: it still
            exists, still holds its key, and is one menu click from working
            again. */}
        <ProviderMark
          provider={record.catalogProvider ?? ''}
          className={cn(record.enabled ? 'text-foreground' : 'text-muted-foreground/60')}
        />

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
              {models.filter((model) => !model.hidden).length} of {models.length} {noun}s offered
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
              Add {noun}
            </MenuItem>

            <MenuItem
              onSelect={() => {
                setMenuOpen(false)
                setExpanded((value) => !value)
              }}
            >
              {expanded ? `Hide ${noun}s` : `Show ${noun}s`}
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
            noun={noun}
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
