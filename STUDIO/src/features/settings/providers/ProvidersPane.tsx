import { useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Icons } from '@/components/icons'
import { ProviderMark } from '@/features/models'
import { Button, MenuItem, Popover, Segmented } from '@/components/primitives'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Loading, StateNote } from '@/components/state'
import {
  capabilityServesKind,
  connectionKinds,
  servesKindOf,
  SLOTS_BY_KIND,
  type CapabilitySlot,
  type LibraryProvider,
  type ProviderConnection,
  type ProviderKind,
  type ProviderModel,
} from '@/platform/harness'
import { SLOT_LABELS } from '@/domain/models/slots'
import { MEDIA_CATEGORIES, SLOT_VERBS, mediaCategory, type MediaCategory } from '@/domain/models/categories'
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
  media: { title: 'Media', description: 'Which provider makes each kind of media, and with which model.' },
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


/**
 * What a page is about, once the person has chosen: the slots whose
 * defaults it sets, and the vendors and connections that serve them.
 *
 * The Models and Tools pages are one purpose each. The Media page is three,
 * one per category, and this is the shape the category resolves to - so the
 * body below is written once against it, and the page's only extra work is
 * the switch.
 */
interface Purpose {
  readonly name: string
  readonly slots: readonly CapabilitySlot[]
}

const PURPOSE_BY_KIND: Readonly<Record<'language' | 'retrieval', Purpose>> = {
  language: { name: 'Chat', slots: SLOTS_BY_KIND.language },
  retrieval: { name: 'Web tools', slots: SLOTS_BY_KIND.retrieval },
}

function ProviderList({ providers, kind }: { providers: Providers; kind: ProviderKind }) {
  const [category, setCategory] = useState<MediaCategory>('images')

  if (kind !== 'media') {
    return <PurposeBody providers={providers} kind={kind} purpose={PURPOSE_BY_KIND[kind]} />
  }

  // The switch is the page's own, above everything: choosing a category is
  // choosing which providers are even relevant, so it comes before either
  // list. The content beneath fades between categories rather than
  // snapping, so the thumb sliding and the rows changing read as one move.
  const chosen = mediaCategory(category)
  return (
    <>
      <div className="pb-4">
        <Segmented
          ariaLabel="Media category"
          layoutId="media-category"
          value={category}
          onChange={setCategory}
          options={MEDIA_CATEGORIES.map((entry) => ({ id: entry.id, label: entry.name }))}
        />
        <p className="mt-2.5 text-caption text-muted-foreground">{chosen.description}</p>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={chosen.id}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: DURATION.fast, ease: EASE_OUT }}
          className="flex flex-col divide-y"
        >
          <PurposeBody providers={providers} kind={kind} purpose={chosen} />
        </motion.div>
      </AnimatePresence>
    </>
  )
}

/**
 * A run of rows under a small caption, the way the settings sidebar names its
 * groups. A caption and a hairline, not a box: the page is one column, and
 * the two sections are two parts of it, not two containers on it.
 */
function Section({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <section className="pt-5 first:pt-0">
      <p className="mb-1 text-micro uppercase text-muted-foreground/80">{caption}</p>
      <div className="flex flex-col divide-y">{children}</div>
    </section>
  )
}

/** Whether a vendor in the library serves any of the slots. */
function libraryServes(entry: LibraryProvider, slots: readonly CapabilitySlot[]): boolean {
  return entry.capabilities.some((slot) => slots.includes(slot))
}

function PurposeBody({ providers, kind, purpose }: { providers: Providers; kind: ProviderKind; purpose: Purpose }) {
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
  //
  // Within the kind, the purpose narrows further. A connection belongs to
  // the Images category when its vendor serves an image slot - by the
  // library's word when the vendor is in it, by its listed models when it is
  // not - so the voice houses stay off the Images category and the image
  // houses off Voice. A connection nothing can vouch for either way (no
  // library entry, no models listed yet) stays on every category: a row
  // that vanishes the moment it is added is worse than one that is not yet
  // sorted. The models a row offers stay the whole kind's, not the
  // category's: the row's selection is written back as one list, and a list
  // narrowed to images would drop the same connection's video models on save.
  const kindModels = view.models.filter((model) => capabilityServesKind(model.capability, kind))
  const library = view.library.filter(
    (entry) => entry.serves[kind] !== undefined && libraryServes(entry, purpose.slots),
  )
  const connections = view.connections.filter((record) => {
    if (!servesKindOf(record, kind)) return false
    const vendor = view.library.find((entry) => entry.id === record.catalogProvider)
    if (vendor !== undefined) return libraryServes(vendor, purpose.slots)
    const own = kindModels.filter((model) => model.connectionId === record.id)
    if (own.length === 0) return true
    // Only a proven "unsupported" hides the row. An "unknown" model - every
    // probe-adopted row on a custom endpoint - stays visible, the same way
    // the model picker (`domain/models/catalog.ts`) and the vision gate keep
    // unknowns: unstated is not disproven, and a row that vanishes the
    // moment its endpoint lists models is worse than one not yet described.
    return own.some((model) => purpose.slots.some((slot) => model.capability[slot] !== 'unsupported'))
  })
  const noun = NOUN_BY_KIND[kind]
  // What a row says it does here. Under a media category that is the slots
  // it serves of the category's; on the other pages, every kind its one key
  // serves, in the contract's order: "Language, Media" for OpenAI.
  const tagOf = (record: ProviderConnection): string => {
    const vendor = view.library.find((entry) => entry.id === record.catalogProvider)
    const served = vendor === undefined ? [] : vendor.capabilities.filter((slot) => purpose.slots.includes(slot))
    if (kind === 'media' && served.length > 0) return served.map((slot) => SLOT_LABELS[slot]).join(', ')
    return connectionKinds(record)
      .map((entry) => KIND_LABELS[entry])
      .join(', ')
  }

  return (
    <>
      {/* Defaults first: "which model does this use" is the question the page
          is opened with, and the providers are how the answer is widened. */}
      <Section caption="Defaults">
        <DefaultsSection
          slots={purpose.slots}
          noun={noun}
          titles={kind === 'media' ? SLOT_VERBS : {}}
          defaults={view.defaults}
          connections={connections}
          models={kindModels}
          onSet={(slot, ref) => void providers.setDefault(slot, ref)}
        />
      </Section>

      <Section caption="Providers">
        {connections.length === 0 ? (
          <p className="py-3.5 text-ui text-muted-foreground">
            {kind === 'language'
              ? 'No provider yet. Add one to give Studio somewhere to send a request.'
              : kind === 'media'
                ? `No provider serves ${purpose.name.toLowerCase()} yet. Add one, and the defaults above can be filled.`
                : 'No provider serves search or page reading yet. Add one, and the web tools use it.'}
          </p>
        ) : (
          connections.map((record) => (
            <ConnectionRow
              key={record.id}
              record={record}
              tag={tagOf(record)}
              models={kindModels}
              noun={noun}
              providers={providers}
              onAddModel={() => setAddingModel(record)}
              onRemove={() => setRemoving(record)}
            />
          ))
        )}

        <div className="py-3">
          <Button variant="secondary" icon={<Icons.add />} onClick={() => setAdding(true)}>
            Add provider
          </Button>
        </div>
      </Section>

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
        purpose={kind === 'media' ? purpose : undefined}
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
        onLookup={async (modelId) => {
          const result = await providers.lookupModelFacts(modelId)
          return result.ok ? result.value : null
        }}
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
  tag,
  models: pageModels,
  noun,
  providers,
  onAddModel,
  onRemove,
}: {
  record: ProviderConnection
  /** What the row does here: "Images, Image editing" under that category, "Language, Media" on Models. */
  tag: string
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
            <span className="ml-1.5 text-caption text-muted-foreground">{tag}</span>
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
