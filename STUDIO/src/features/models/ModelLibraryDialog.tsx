import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Dialog, MenuLabel, StepSlider, TextField } from '@/components/primitives'
import { Icons, ProviderMark } from '@/components/icons'
import {
  groupCatalog,
  reasoningChoiceNote,
  type CatalogGroup,
  type CatalogModel,
} from '@/domain/models/catalog'
import {
  CatalogStateNote,
  type CatalogState,
} from '@/features/models/CatalogStateNote'
import { ModelListSkeleton } from '@/features/models/ModelListSkeleton'
import { REASONING_LEVEL_NOTES, type ReasoningChoice } from '@/domain/models/types'
import { cn } from '@/lib/cn'

/**
 * The model library: the whole catalog, on a page that can hold it.
 *
 * ---- Why this is a dialog and not the picker -------------------------------
 *
 * The picker is a shortcut - three recents and a door. This is the room behind
 * the door: every model of every connection, with the facts a decision this
 * size deserves. An aggregator connection carries hundreds of models; squeezed
 * into a small popover they were an unscrollable wall, and the facts that
 * distinguish them - price, context, what the model can actually do - had
 * nowhere to appear at all. Here the list lives on the left and the facts on
 * the right, and choosing is explicit: a model is highlighted, its details
 * shown, and a button applies it. Nothing is applied by merely clicking a row.
 *
 * ---- The second step of the pick -------------------------------------------
 *
 * Applying shows the reasoning dial in the details pane, resting on Default -
 * leaving it alone is itself the choice "the provider decides". A model with
 * no reasoning support has no dial at all - present and inert would be a
 * control that lies.
 */
export function ModelLibraryDialog({
  open,
  onClose,
  catalog,
  onUse,
  onOpenSettings,
}: {
  open: boolean
  onClose: () => void
  catalog: CatalogState
  onUse: (modelId: string, reasoningLevel: ReasoningChoice) => void
  onOpenSettings: () => void
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningChoice>('default')

  // Reopening starts over: a library that remembers a query from last time
  // answers a question nobody is asking yet.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setSelectedId(null)
      setReasoningLevel('default')
    }
  }, [open])

  const groups = useMemo(() => {
    if (catalog.phase.status !== 'ready') return []
    const needle = query.trim().toLowerCase()
    const models =
      needle === ''
        ? catalog.models
        : catalog.models.filter((candidate) =>
            [candidate.name, candidate.modelId, candidate.author, candidate.connectionName]
              .join('\n')
              .toLowerCase()
              .includes(needle),
          )
    return groupCatalog(models)
  }, [catalog, query])

  const selected =
    selectedId === null
      ? undefined
      : groups.flatMap((group) => group.models).find((model) => model.id === selectedId)

  const use = () => {
    if (selected === undefined) return
    onUse(selected.id, reasoningLevel)
    onClose()
  }

  // The library is opened from the top strip, and the strip is itself a
  // positioned box - the Dialog's `absolute inset-0` overlay would measure
  // itself against the strip's fifty-odd pixels and open as a sliver inside
  // it. Portalled to the body, the overlay covers the window, which is what
  // "a page over the app" means. The Popover, the Tooltip, and the lightbox
  // escape their ancestors for the same reason.
  return createPortal(
    <Dialog
      open={open}
      onClose={onClose}
      title="Model library"
      // Two thirds of the window: wide enough that an aggregator's catalog
      // reads as a list and a pane rather than a scroll, capped so it never
      // pretends to be the whole app.
      width="min(72rem, 74vw)"
      footer={
        <>
          <Button variant="ghost" onClick={onOpenSettings}>
            <Icons.settings /> Add models in Settings...
          </Button>
          <Button variant="primary" disabled={selected === undefined} onClick={use}>
            Use this model
          </Button>
        </>
      }
    >
      <div className="flex h-full min-h-0 gap-4">
        <div className="flex w-[46%] min-w-0 flex-col gap-2">
          {catalog.phase.status === 'ready' ? (
            <TextField
              value={query}
              onChange={setQuery}
              placeholder={`Search ${catalog.models.length} models`}
              ariaLabel="Search models"
              autoFocus
            />
          ) : null}
          <div className="studio-scroll-bounded min-h-0 flex-1 overflow-y-auto pr-1">
            {catalog.phase.status !== 'ready' ? (
              // Loading holds the list's shape (`ModelListSkeleton`); the other
              // named states keep their sentence -- a menu that cannot be read
              // says so, it does not preview rows that are not coming.
              catalog.phase.status === 'loading' ? (
                <ModelListSkeleton />
              ) : (
                <CatalogStateNote catalog={catalog} />
              )
            ) : groups.length === 0 ? (
              <p className="px-2 py-2 text-ui text-muted-foreground">
                {query.trim() === ''
                  ? 'No models to browse yet. Add one in Settings.'
                  : `No models match "${query.trim()}".`}
              </p>
            ) : (
              groups.map((group) => (
                <div key={group.connectionId}>
                  <MenuLabel>
                    <span className="flex items-center gap-1.5">
                      <ProviderMark provider={group.connectionVendor} />
                      {group.connectionName}
                    </span>
                  </MenuLabel>
                  {group.models.map((candidate) => (
                    <LibraryRow
                      key={candidate.id}
                      model={candidate}
                      selected={candidate.id === selectedId}
                      onSelect={() => {
                        setSelectedId(candidate.id)
                        setReasoningLevel('default')
                      }}
                    />
                  ))}
                </div>
              ))
            )}
          </div>
        </div>

        <div className="studio-scroll-bounded min-h-0 flex-1 overflow-y-auto border-l pl-4">
          {selected === undefined ? (
            <p className="px-2 py-2 text-ui text-muted-foreground">
              Select a model to see what it does and what it costs.
            </p>
          ) : (
            <ModelDetails model={selected} reasoningLevel={reasoningLevel} onReasoning={setReasoningLevel} />
          )}
        </div>
      </div>
    </Dialog>,
    document.body,
  )
}

function LibraryRow({
  model,
  selected,
  onSelect,
}: {
  model: CatalogModel
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onSelect}
      className={cn(
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui',
        'transition-colors duration-fast',
        selected
          ? 'bg-selected text-foreground'
          : 'text-muted-foreground hover:bg-tint hover:text-foreground',
      )}
    >
      <ProviderMark provider={model.author} className="shrink-0 opacity-90" />
      <span className="min-w-0 flex-1 truncate">{model.name}</span>
      <span className="shrink-0 text-micro text-muted-foreground">
        {contextHint(model)}
      </span>
    </button>
  )
}

/** A readable context size, or nothing - a row of dashes for every unknown
 * would be noise where the point is the models that do name one. */
function contextHint(model: CatalogModel): string {
  if (model.contextWindow === 'unknown') return ''
  return `${Math.round(model.contextWindow / 1000)}k`
}

function ModelDetails({
  model,
  reasoningLevel,
  onReasoning,
}: {
  model: CatalogModel
  reasoningLevel: ReasoningChoice
  onReasoning: (level: ReasoningChoice) => void
}) {
  const levels = model.reasoningLevels.map((level) => {
    const note = REASONING_LEVEL_NOTES.find((entry) => entry.id === level)
    return { id: level, name: note?.name ?? capital(level), note: note?.note }
  })

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex items-center gap-2.5">
        <ProviderMark provider={model.author} size="lg" />
        <div className="min-w-0">
          <p className="truncate text-ui text-foreground">{model.name}</p>
          <p className="truncate text-micro text-muted-foreground">
            {model.author} · through {model.connectionName}
          </p>
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <Detail caption="Context window" value={tokens(model.contextWindow)} />
        <Detail caption="Max output" value={tokens(model.capability.maxOutputTokens)} />
        <Detail caption="Input price" value={price(model.pricing.input)} />
        <Detail caption="Output price" value={price(model.pricing.output)} />
        <Detail caption="Cache read" value={price(model.pricing.cacheRead)} />
        <Detail caption="Cache write" value={price(model.pricing.cacheWrite)} />
      </div>

      <div>
        <p className="pb-1.5 text-micro text-muted-foreground">Capabilities</p>
        <div className="flex flex-wrap gap-1.5">
          <Capability name="Streaming" state={model.capability.streaming} />
          <Capability name="Tool calling" state={model.capability.toolCalling} />
          <Capability name="Vision" state={model.capability.vision} />
          <Capability name="Reasoning" state={model.capability.reasoning} />
        </div>
      </div>

      {levels.length > 0 ? (
        <div>
          <p className="pb-1 text-micro text-muted-foreground">Reasoning effort</p>
          <StepSlider
            steps={[
              { id: 'default' as const, name: 'Default', note: reasoningChoiceNote('default') },
              ...levels,
            ]}
            value={reasoningLevel}
            onChange={onReasoning}
          />
        </div>
      ) : null}
    </div>
  )
}

function Detail({ caption, value }: { caption: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="text-micro text-muted-foreground">{caption}</span>
      <span className="truncate text-ui text-foreground">{value}</span>
    </div>
  )
}

function Capability({ name, state }: { name: string; state: 'supported' | 'unsupported' | 'unknown' }) {
  return (
    <span
      className={cn(
        'rounded-full border px-2 py-0.5 text-micro',
        state === 'supported'
          ? 'border-transparent bg-tint text-foreground'
          : 'text-muted-foreground',
      )}
    >
      {name}
      {state === 'unknown' ? ' ?' : ''}
    </span>
  )
}

/** USD per million tokens, two decimals - or an em dash for "unknown", the
 * same answer the wire record gives, shown rather than hidden. */
function price(value: number | 'unknown'): string {
  if (value === 'unknown') return '—'
  return `$${value.toFixed(2)} / M`
}

function tokens(value: number | 'unknown'): string {
  if (value === 'unknown') return '—'
  return value.toLocaleString('en-US')
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

/** Re-exported for the picker's own levels; keeps one source for the type. */
export type { CatalogGroup }
