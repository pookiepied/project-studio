import { useState } from 'react'
import { Button, MenuItem, Popover, TextField } from '@/components/primitives'
import { ProviderMark } from '@/features/models'
import type {
  CapabilitySlot,
  DefaultSelection,
  ModelReferenceSlot,
  ProviderConnection,
  ProviderModel,
} from '@/platform/harness'
import { ALL_SLOTS, SLOT_LABELS } from '@/domain/models/slots'
import { FEATURED_LABEL, featuredFirst } from '@/domain/models/featured'

/**
 * The capability defaults: which model fills each slot.
 *
 * Nine slots, one row each, all read and written through the same two calls
 * (`getDefaults` / `setDefault`) - adding a slot is a contract change, and
 * this section grows to meet it with no new state.
 *
 * ---- The three honest states -----------------------------------------------
 *
 * 1. Set: the chosen model, named, with its mark. One control to change or
 *    clear it.
 * 2. Fillable but unset: an empty picker. Nothing is invented; the slot is
 *    simply waiting for a choice.
 * 3. Not fillable: the picker is replaced by one sentence saying what would
 *    have to be connected - a provider serving that capability - because a
 *    picker with zero rows is a dead control wearing the shape of a choice.
 *
 * A fourth state is rendered where it is earned: a default whose model the
 * provider no longer offers, or whose row has otherwise vanished, is shown
 * with that fact stated and never silently replaced. The pointer is kept on
 * the harness side; the user decides whether to re-point it.
 *
 * ---- The placeholders -------------------------------------------------------
 *
 * Chat, web retrieval, and transcription are invoked today - the last by
 * dictation, the composer's microphone button, which is an app feature rather
 * than a tool. The rest - images, video, speech, embeddings - have their whole
 * surface here and no invocation path yet: the tools that will drive them are
 * named in the row itself, which is where the one honest sentence belongs.
 * Everything up to the missing piece works.
 */

/** The slots nothing invokes yet, and the sentence that says so, once. */
const INVOKED: Readonly<Record<CapabilitySlot, boolean>> = {
  textGeneration: true,
  imageGeneration: true,
  imageEditing: true,
  videoGeneration: true,
  speechGeneration: true,
  transcription: true,
  embeddings: false,
  webSearch: true,
  webFetch: true,
}

const PLACEHOLDER_BY_SLOT: Readonly<Record<CapabilitySlot, string>> = {
  textGeneration: '',
  imageGeneration: '',
  imageEditing: '',
  videoGeneration: '',
  speechGeneration: '',
  transcription: '',
  embeddings: 'Nothing invokes this yet - a Studio feature will embed through it in a later update.',
  webSearch: '',
  webFetch: '',
}

export function DefaultsSection({
  slots = ALL_SLOTS,
  noun = 'model',
  defaults,
  connections,
  models,
  onSet,
}: {
  /** The slots this page shows; every slot when not given. */
  slots?: readonly CapabilitySlot[]
  /** What the page calls a choice: "model" unless the page says otherwise. */
  noun?: string
  defaults: DefaultSelection
  connections: readonly ProviderConnection[]
  models: readonly ProviderModel[]
  onSet: (slot: CapabilitySlot, ref: ModelReferenceSlot | undefined) => void
}) {
  return (
    <div className="flex flex-col divide-y">
      {slots.map((slot) => (
        <SlotRow
          key={slot}
          slot={slot}
          current={defaults[slot]}
          connections={connections}
          models={models}
          noun={noun}
          onSet={onSet}
        />
      ))}
    </div>
  )
}

function SlotRow({
  slot,
  current,
  connections,
  models,
  noun,
  onSet,
}: {
  slot: CapabilitySlot
  current: ModelReferenceSlot | undefined
  connections: readonly ProviderConnection[]
  models: readonly ProviderModel[]
  noun: string
  onSet: (slot: CapabilitySlot, ref: ModelReferenceSlot | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const eligible = models.filter(
    (model) =>
      model.available &&
      !model.hidden &&
      model.capability[slot] !== 'unsupported' &&
      model.capability[slot] !== 'unknown',
  )
  const currentModel = current
    ? models.find((model) => model.connectionId === current.connectionId && model.modelId === current.modelId)
    : undefined
  const currentConnection = current
    ? connections.find((connection) => connection.id === current.connectionId)
    : undefined

  // A default that points at a model the catalog no longer carries at all is
  // vanished; one the provider stopped offering is marked. Both say so.
  const vanished = current !== undefined && currentModel === undefined
  const markedUnavailable = currentModel !== undefined && !currentModel.available

  // Featured first: the recommendation is the top of the list, which is the
  // whole point of a recommendation. The search keeps that order among the
  // rows it keeps.
  const ordered = featuredFirst(eligible)

  const visible = ordered.filter((model) => {
    const needle = search.trim().toLowerCase()
    if (needle === '') return true
    return (
      model.displayName.toLowerCase().includes(needle) ||
      model.modelId.toLowerCase().includes(needle)
    )
  })

  const label = SLOT_LABELS[slot]
  const placeholder = PLACEHOLDER_BY_SLOT[slot]

  return (
    <div className="flex items-start justify-between gap-6 py-3.5">
      <div className="min-w-0 flex-1">
        <p className="text-ui text-foreground">{label}</p>

        {current !== undefined && currentModel !== undefined ? (
          <p className="mt-0.5 flex items-center gap-1.5 text-caption text-muted-foreground">
            <ProviderMark provider={vendorOf(currentModel, currentConnection)} />
            <span className={markedUnavailable ? 'text-danger' : undefined}>
              {currentModel.displayName}
              {markedUnavailable ? ' - no longer offered by its provider' : ''}
            </span>
            {INVOKED[slot] ? null : (
              <span className="text-muted-foreground/70">({placeholder})</span>
            )}
          </p>
        ) : vanished ? (
          <p className="mt-0.5 text-caption text-danger">
            Points at a model the catalog no longer lists. Choose another below or clear it.
          </p>
        ) : (
          <p className="mt-0.5 text-caption text-muted-foreground">
            {eligible.length === 0
              ? placeholder !== ''
                ? `No model with ${label.toLowerCase()} is connected. ${placeholder}`
                : `Connect a provider serving ${label.toLowerCase()} to fill this slot.`
              : 'Nothing chosen yet.'}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <Popover
          open={open}
          onOpenChange={setOpen}
          side="bottom"
          align="end"
          className="min-w-64"
          trigger={
            <Button
              variant="secondary"
              size="sm"
              disabled={eligible.length === 0 && current === undefined}
              onClick={() => setOpen((value) => !value)}
            >
              {current === undefined ? 'Choose' : 'Change'}
            </Button>
          }
        >
          <div className="p-1.5">
            <TextField value={search} onChange={setSearch} placeholder={`Search ${noun}s`} />
          </div>
          <div className="max-h-64 overflow-y-auto">
            {visible.map((model) => {
              const connection = connections.find((entry) => entry.id === model.connectionId)
              return (
                <MenuItem
                  key={`${model.connectionId}/${model.modelId}`}
                  selected={
                    current !== undefined &&
                    current.connectionId === model.connectionId &&
                    current.modelId === model.modelId
                  }
                  onSelect={() => {
                    onSet(slot, { connectionId: model.connectionId, modelId: model.modelId })
                    setOpen(false)
                    setSearch('')
                  }}
                >
                  <span className="flex items-center gap-1.5">
                    <ProviderMark provider={vendorOf(model, connection)} />
                    {model.displayName}
                    {model.featured ? (
                      <span className="text-muted-foreground/70">{FEATURED_LABEL}</span>
                    ) : null}
                  </span>
                </MenuItem>
              )
            })}
            {visible.length === 0 ? (
              <p className="px-2 py-2 text-caption text-muted-foreground">No {noun} by that name.</p>
            ) : null}
          </div>
        </Popover>
        {current !== undefined ? (
          <Button variant="ghost" size="sm" onClick={() => onSet(slot, undefined)}>
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function vendorOf(model: ProviderModel, connection: ProviderConnection | undefined): string {
  if (connection === undefined) {
    const separator = model.modelId.indexOf('/')
    return separator > 0 ? model.modelId.slice(0, separator) : model.connectionId
  }
  return connection.catalogProvider ?? connection.id
}
