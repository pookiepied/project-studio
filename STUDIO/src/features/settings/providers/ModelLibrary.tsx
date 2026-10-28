import { useMemo, useState } from 'react'
import { Icons } from '@/components/icons'
import { ProviderMark } from '@/features/models'
import { Button, MenuItem, Popover, TextField } from '@/components/primitives'
import type { ProviderConnection, ProviderModel } from '@/platform/harness'
import { ALL_SLOTS, SLOT_LABELS } from '@/domain/models/slots'
import { FEATURED_LABEL, featuredFirst } from '@/domain/models/featured'
import { cn } from '@/lib/cn'

/**
 * The model library: one connection's models, with what each can do.
 *
 * ---- Selection is the product's own offer -----------------------------------
 *
 * The checkboxes are not decoration. What is selected here is exactly what the
 * rest of Studio offers - the composer's picker, the capability slots, the
 * defaults. "Select all" and "none" are one gesture each, because a fresh
 * connection arrives with everything offered and a person who wants three of
 * two hundred and seventy-one models should not untick them one by one.
 * Selection is stored as hiding - the same fact the per-model gesture writes -
 * so the two can never disagree about what "offered" means.
 *
 * ---- The rows tell the truth ------------------------------------------------
 *
 * Each row shows the capabilities it actually has, the context window when the
 * provider states one, and the price when there is one to show. "Unknown"
 * reads as unknown - a word, not a missing tick - because an undescribed
 * dimension is a fact about the catalog, not a zero. A row the provider's own
 * model list no longer names is marked, greyed, and not selectable: the
 * connection was taught what its provider serves, by probe.
 *
 * ---- The shelf, and what comes first ----------------------------------------
 *
 * The featured models - Studio's own recommendation, a word of the declared
 * catalog - lead the list, marked, before whatever the vendor lists live. The
 * order is not the catalog's; it is the reader's: someone looking at two
 * hundred ids is looking for the few worth reading, and they are the top ones.
 */

export function ModelLibrary({
  connection,
  models,
  noun = 'model',
  onSelectionChange,
  onAddModel,
  onEditModel,
  onRemoveModel,
  selectionBusy,
}: {
  connection: ProviderConnection
  models: readonly ProviderModel[]
  /** What the page calls one row: "model" unless the page says otherwise. */
  noun?: string
  /** Applies a whole-shelf selection; the complement is stored as hiding. */
  onSelectionChange: (selectedIds: readonly string[]) => void
  onAddModel: () => void
  /** Rename of one row; a hidden flag rides along when the menu asked for one. */
  onEditModel: (modelId: string, displayName: string, hidden?: boolean) => void
  onRemoveModel: (modelId: string) => void
  selectionBusy: boolean
}) {
  const [search, setSearch] = useState('')
  const [renaming, setRenaming] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return featuredFirst(models)
    return featuredFirst(
      models.filter(
        (model) =>
          model.displayName.toLowerCase().includes(needle) ||
          model.modelId.toLowerCase().includes(needle),
      ),
    )
  }, [models, search])

  const offered = models.filter((model) => !model.hidden && model.available)
  const allSelected = models.length > 0 && offered.length === models.length

  return (
    <div className="flex flex-col gap-2 rounded-md border bg-surface/50 p-2">
      <div className="flex items-center gap-2">
        <TextField value={search} onChange={setSearch} placeholder={`Search ${noun}s`} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <Button
          variant="secondary"
          size="sm"
          busy={selectionBusy}
          disabled={selectionBusy || allSelected}
          onClick={() => onSelectionChange(models.map((model) => model.modelId))}
        >
          Select all
        </Button>
        <Button
          variant="secondary"
          size="sm"
          busy={selectionBusy}
          disabled={selectionBusy || offered.length === 0}
          onClick={() => onSelectionChange([])}
        >
          Select none
        </Button>
        <Button variant="secondary" size="sm" icon={<Icons.add />} onClick={onAddModel}>
          Add model
        </Button>
      </div>

      <div className="max-h-96 divide-y overflow-y-auto">
        {visible.map((model) => {
          const offeredRow = !model.hidden && model.available
          return (
            <div key={model.modelId} className="flex items-start gap-2 py-2">
              <input
                type="checkbox"
                aria-label={`Offer ${model.displayName}`}
                checked={!model.hidden}
                disabled={!model.available}
                onChange={() => onSelectionChange(toggleOffered(models, model.modelId))}
                className="mt-1 size-3.5 shrink-0 accent-current"
              />
              <ProviderMark provider={authorVendor(model, connection)} />
              <div className="min-w-0 flex-1">
                {renaming === model.modelId ? (
                  <div className="flex items-center gap-1.5">
                    {/* `flex-1` and not `w-full`: the row also holds the save
                        and cancel buttons, and a full-width field in a flex
                        row is the input's intrinsic width, not the space left
                        over — which is how the field used to run past the
                        card's edge and get cut off. */}
                    <TextField
                      value={renameValue}
                      onChange={setRenameValue}
                      className="flex-1"
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        const trimmed = renameValue.trim()
                        if (trimmed.length > 0) onEditModel(model.modelId, trimmed)
                        setRenaming(null)
                      }}
                    >
                      Save
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setRenaming(null)}>
                      Cancel
                    </Button>
                  </div>
                ) : (
                  <p className={cn('truncate text-ui', offeredRow ? 'text-foreground' : 'text-muted-foreground')}>
                    {model.displayName}
                  </p>
                )}
                <p className="truncate text-caption text-muted-foreground">{model.modelId}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-caption text-muted-foreground">
                  {model.featured ? (
                    <span className="text-foreground/75">{FEATURED_LABEL}</span>
                  ) : null}
                  {capabilityChips(model)}
                  <span>{windowText(model)}</span>
                  <span aria-hidden>-</span>
                  <span>{priceText(model)}</span>
                  {model.available ? null : (
                    <span className="text-danger">Not offered by the provider right now</span>
                  )}
                </p>
              </div>
              <ModelRowMenu
                model={model}
                onRename={() => {
                  setRenaming(model.modelId)
                  setRenameValue(model.displayName)
                }}
                onHide={() => onEditModel(model.modelId, model.displayName, true)}
                onShow={() => onEditModel(model.modelId, model.displayName, false)}
                onRemove={() => onRemoveModel(model.modelId)}
              />
            </div>
          )
        })}
        {visible.length === 0 ? (
          <p className="px-1 py-3 text-caption text-muted-foreground">
            No model by that name on this connection.
          </p>
        ) : null}
      </div>
    </div>
  )
}

function ModelRowMenu({
  model,
  onRename,
  onHide,
  onShow,
  onRemove,
}: {
  model: ProviderModel
  onRename: () => void
  onHide: () => void
  onShow: () => void
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      trigger={
        <button
          type="button"
          aria-label={`${model.displayName} options`}
          onClick={() => setOpen((value) => !value)}
          className="flex size-[var(--control-sm)] shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-tint"
        >
          <Icons.more />
        </button>
      }
    >
      <MenuItem
        onSelect={() => {
          setOpen(false)
          onRename()
        }}
      >
        Rename
      </MenuItem>
      {model.hidden ? (
        <MenuItem
          onSelect={() => {
            setOpen(false)
            onShow()
          }}
        >
          Offer again
        </MenuItem>
      ) : (
        <MenuItem
          onSelect={() => {
            setOpen(false)
            onHide()
          }}
        >
          Hide
        </MenuItem>
      )}
      {model.origin === 'manual' ? (
        <MenuItem
          destructive
          icon={<Icons.delete />}
          onSelect={() => {
            setOpen(false)
            onRemove()
          }}
        >
          Remove
        </MenuItem>
      ) : null}
    </Popover>
  )
}

/** The selection after ticking one row: the complement of hiding it. */
function toggleOffered(models: readonly ProviderModel[], modelId: string): readonly string[] {
  return models
    .filter((model) => (model.modelId === modelId ? model.hidden : !model.hidden))
    .map((model) => model.modelId)
}

/** The mark a model row wears: the author where the id names one, else the vendor. */
function authorVendor(model: ProviderModel, connection: ProviderConnection): string {
  const vendor = connection.catalogProvider ?? connection.id
  const separator = model.modelId.indexOf('/')
  return separator > 0 ? model.modelId.slice(0, separator) : vendor
}

function capabilityChips(model: ProviderModel): readonly string[] {
  const named = ALL_SLOTS.filter((slot) => model.capability[slot] === 'supported').map(
    (slot) => SLOT_LABELS[slot],
  )
  return named.length === 0 ? ['Capabilities unknown'] : named
}

function windowText(model: ProviderModel): string {
  const window = model.capability.contextWindow
  return window === 'unknown' ? 'Context unknown' : `${window.toLocaleString()} context`
}

/**
 * The price, or the word for not having one.
 *
 * Pricing is per million tokens when it exists at all; audio and retrieval
 * vendors bill in units this contract does not model, so "unknown" is the
 * honest answer for most non-chat rows and is drawn as a word, never as 0.
 */
function priceText(model: ProviderModel): string {
  const { input, output } = model.pricing
  if (input === 'unknown' || output === 'unknown') return 'Price unknown'
  return `$${input}/M in, $${output}/M out`
}
