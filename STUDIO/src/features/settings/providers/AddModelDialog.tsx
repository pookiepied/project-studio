import { useEffect, useRef, useState } from 'react'
import { Button, Dialog, TextField } from '@/components/primitives'
import {
  REASONING_LEVELS,
  type CapabilityState,
  type HarnessFailure,
  type ModelCapability,
  type ModelFacts,
  type ReasoningLevel,
} from '@/platform/harness'
import { SLOT_LABELS } from '@/domain/models/slots'
import type { ManualModelInput } from '@/platform/harness/client'

/**
 * Adding a model to an existing provider.
 *
 * This is the form for a model the catalogs have never heard of, entered by
 * hand under a provider they do - a fine-tune, a model that shipped after the
 * last catalog build, a private deployment. Everything it asks for is a fact
 * the product will then act on or refuse:
 *
 *   - the capabilities are chosen explicitly against the contract's real
 *     fields. What is ticked here is what the composer offers, what the
 *     capability slots can be filled with, and what a turn is refused for.
 *     Untouched fields are stored as "unknown" - never as "unsupported",
 *     which would advertise a limit nobody confirmed;
 *   - the reasoning levels are that model's own levels, ticked from the same
 *     six the built-in models carry - not a fixed dial. A model that reasons
 *     only at low and medium says exactly that, and the composer's control
 *     follows;
 *   - the context window and output cap are optional numbers; left empty they
 *     stay unknown, the meter says so, and the form says what else that
 *     costs: a model with no window is only compacted when its provider
 *     refuses a request.
 *
 * ---- The catalog fills in first --------------------------------------------
 *
 * A slug typed here is very often a model the catalog serves under other
 * hosts - GLM 5.3 Flash on a private gateway is the same model Z.ai and
 * OpenRouter list - and the window, the output cap, whether it reasons and
 * whether it reads images are the model's facts, not the host's. So the form
 * asks the harness about the slug as it is typed and fills what it learns
 * into fields the person has not touched. It is a pre-fill and not a claim:
 * every value stays editable, the caption says how many entries it rests on,
 * and a slug nobody lists leaves the form as it was.
 *
 * Chat is deliberately not a checkbox. A hand-entered model under a provider
 * exists to answer turns, so `textGeneration` is stated supported for the
 * caller; the dialog's job is the dimensions the user actually knows.
 */

/** The capability checkboxes, in the order a person would read them. */
const CAPABILITY_CHOICES: readonly {
  readonly key: CapabilityStateKey
  readonly label: string
  readonly hint: string
}[] = [
  { key: 'reasoning', label: 'Reasoning', hint: 'Can be asked to think at a chosen level' },
  { key: 'toolCalling', label: 'Tool calling', hint: 'Can call tools during a turn' },
  { key: 'vision', label: 'Vision', hint: 'Reads images in the conversation' },
  { key: 'streaming', label: 'Streaming', hint: 'Answers arrive as deltas' },
  { key: 'imageGeneration', label: SLOT_LABELS.imageGeneration, hint: 'Produces images' },
  { key: 'imageEditing', label: SLOT_LABELS.imageEditing, hint: 'Edits an image it is given' },
  { key: 'videoGeneration', label: SLOT_LABELS.videoGeneration, hint: 'Produces video' },
  { key: 'speechGeneration', label: SLOT_LABELS.speechGeneration, hint: 'Speaks text aloud' },
  { key: 'transcription', label: SLOT_LABELS.transcription, hint: 'Transcribes audio' },
  { key: 'documentReading', label: SLOT_LABELS.documentReading, hint: 'Reads a PDF or a scanned page as text' },
  { key: 'embeddings', label: SLOT_LABELS.embeddings, hint: 'Produces embeddings' },
  { key: 'webSearch', label: SLOT_LABELS.webSearch, hint: 'Searches the web' },
  { key: 'webFetch', label: SLOT_LABELS.webFetch, hint: 'Fetches a named page' },
]

/**
 * Only the state-valued capability keys: the two numeric dimensions are their
 * own fields below, and a checkbox that could hold a number would be a
 * checkbox lying about what it ticks.
 */
type CapabilityStateKey = {
  [K in keyof ModelCapability]: ModelCapability[K] extends CapabilityState | undefined ? K : never
}[keyof ModelCapability]

type CapabilityDraft = { -readonly [K in CapabilityStateKey]?: ModelCapability[K] }

/** How long the slug rests before the catalog is asked about it. */
const LOOKUP_DELAY_MS = 350

/** What the catalog said about the slug in the field, and for which slug. */
type Lookup =
  | { readonly kind: 'idle' }
  | { readonly kind: 'asking'; readonly slug: string }
  | { readonly kind: 'answered'; readonly slug: string; readonly facts: ModelFacts }

type FilledField = 'capabilities' | 'levels' | 'contextWindow' | 'maxOutputTokens'

export function AddModelDialog({
  open,
  onClose,
  connectionName,
  onLookup,
  onAdd,
}: {
  open: boolean
  onClose: () => void
  /** The connection the model will be filed under, named in the copy. */
  connectionName: string
  /**
   * What the catalog knows about a slug, or null when it could not be asked.
   * Optional so a caller with no harness still has a working form.
   */
  onLookup?: (modelId: string) => Promise<ModelFacts | null>
  /** Resolves to the failure to show, or null when the model was added. */
  onAdd: (model: ManualModelInput) => Promise<HarnessFailure | null>
}) {
  const [modelId, setModelId] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [capabilities, setCapabilities] = useState<CapabilityDraft>({})
  const [levels, setLevels] = useState<readonly ReasoningLevel[]>([])
  const [contextWindow, setContextWindow] = useState('')
  const [maxOutputTokens, setMaxOutputTokens] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<HarnessFailure | null>(null)
  const [lookup, setLookup] = useState<Lookup>({ kind: 'idle' })
  // Which fields the person has typed in or ticked themselves. The catalog
  // fills only the others, so a corrected number is never overwritten by a
  // later answer for a different slug.
  const touched = useRef<Set<FilledField>>(new Set())

  const close = () => {
    setModelId('')
    setDisplayName('')
    setCapabilities({})
    setLevels([])
    setContextWindow('')
    setMaxOutputTokens('')
    setFailure(null)
    setBusy(false)
    setLookup({ kind: 'idle' })
    touched.current.clear()
    onClose()
  }

  const slug = modelId.trim()

  // Ask the catalog once the slug has rested. The answer is applied only if
  // the slug is still the one asked about - a person typing through several
  // ids must not have the first answer land on the last id.
  useEffect(() => {
    if (!open || onLookup === undefined) return
    if (slug === '') {
      setLookup({ kind: 'idle' })
      return
    }
    let current = true
    const timer = window.setTimeout(() => {
      setLookup({ kind: 'asking', slug })
      void onLookup(slug).then((facts) => {
        if (!current) return
        if (facts === null) {
          setLookup({ kind: 'idle' })
          return
        }
        setLookup({ kind: 'answered', slug, facts })
        if (!facts.found) return
        const untouched = (field: FilledField) => !touched.current.has(field)
        if (untouched('contextWindow') && facts.contextWindow !== null) {
          setContextWindow(String(facts.contextWindow))
        }
        if (untouched('maxOutputTokens') && facts.maxOutputTokens !== null) {
          setMaxOutputTokens(String(facts.maxOutputTokens))
        }
        if (untouched('capabilities')) {
          setCapabilities({
            streaming: 'supported',
            ...(facts.reasoning ? { reasoning: 'supported' } : {}),
            ...(facts.vision ? { vision: 'supported' } : {}),
          })
        }
        if (untouched('levels') && facts.reasoning) setLevels(facts.reasoningLevels)
      })
    }, LOOKUP_DELAY_MS)
    return () => {
      current = false
      window.clearTimeout(timer)
    }
  }, [open, slug, onLookup])

  const toggleCapability = (key: CapabilityStateKey): void => {
    touched.current.add('capabilities')
    setCapabilities((current) => {
      const next: CapabilityDraft = { ...current }
      if (next[key] === 'supported') {
        delete next[key]
      } else {
        next[key] = 'supported'
      }
      return next
    })
  }

  const reasons = capabilities.reasoning === 'supported'
  const valid = slug.length > 0 && displayName.trim().length > 0
  const windowEmpty = contextWindow.trim() === ''
  const answered = lookup.kind === 'answered' && lookup.slug === slug ? lookup.facts : null

  const submit = async (): Promise<boolean> => {
    if (!valid || busy) return false
    setBusy(true)
    setFailure(null)

    const windowValue = Number.parseInt(contextWindow.trim(), 10)
    const tokensValue = Number.parseInt(maxOutputTokens.trim(), 10)

    const input: ManualModelInput = {
      modelId: slug,
      displayName: displayName.trim(),
      // textGeneration is stated, not guessed: see the docblock. Everything
      // unticked stays absent, which the harness stores as unknown.
      capability: {
        textGeneration: 'supported',
        ...capabilities,
        ...(Number.isFinite(windowValue) && windowValue > 0 ? { contextWindow: windowValue } : {}),
        ...(Number.isFinite(tokensValue) && tokensValue > 0 ? { maxOutputTokens: tokensValue } : {}),
      },
      // Only a model that reasons carries levels; a checkbox set without the
      // reasoning box is a contradiction the form resolves by dropping it.
      ...(reasons && levels.length > 0 ? { reasoningLevels: levels } : {}),
    }

    const error = await onAdd(input)
    if (error === null) {
      close()
      return true
    }
    setBusy(false)
    setFailure(error)
    return false
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add model"
      width="28rem"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!valid} busy={busy} onClick={() => void submit()}>
            Add model
          </Button>
        </>
      }
    >
      <div className="flex max-h-[32rem] flex-col gap-4 overflow-y-auto pt-1">
        <p className="text-caption text-muted-foreground">
          Added under {connectionName}. The model id is exactly what the provider calls it on the wire.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Model id (slug)</span>
          <TextField value={modelId} onChange={setModelId} placeholder="my-org/my-fine-tune" autoFocus />
          {answered === null ? null : (
            <span className="text-caption text-muted-foreground/80" aria-live="polite">
              {answered.found
                ? `Filled from ${
                    answered.entries === 1 ? 'the catalog entry' : `${answered.entries} catalog entries`
                  } for this model. Change anything that is wrong.`
                : 'Not in the catalog. Say what you know about it below.'}
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-caption text-muted-foreground">Display name</span>
          <TextField value={displayName} onChange={setDisplayName} placeholder="My fine tune" />
        </label>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="text-caption text-muted-foreground">Capabilities</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {CAPABILITY_CHOICES.map((choice) => (
              <label key={choice.key} className="flex items-center gap-2 text-ui text-foreground">
                <input
                  type="checkbox"
                  checked={capabilities[choice.key] === 'supported'}
                  onChange={() => toggleCapability(choice.key)}
                  className="size-3.5 accent-current"
                />
                <span title={choice.hint}>{choice.label}</span>
              </label>
            ))}
          </div>
          <p className="text-caption text-muted-foreground/80">
            Unticked stays unknown - the app will not claim a limit nobody confirmed.
          </p>
        </fieldset>

        {reasons ? (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="text-caption text-muted-foreground">Reasoning levels</legend>
            <div className="flex flex-wrap gap-1.5">
              {REASONING_LEVELS.map((level) => {
                const selected = levels.includes(level)
                return (
                  <button
                    key={level}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => {
                      touched.current.add('levels')
                      setLevels((current) =>
                        selected ? current.filter((entry) => entry !== level) : [...current, level],
                      )
                    }}
                    className={`rounded-full border px-2.5 py-0.5 text-caption transition-colors duration-fast ${
                      selected
                        ? 'border-foreground/40 bg-selected text-foreground'
                        : 'text-muted-foreground hover:bg-tint'
                    }`}
                  >
                    {level}
                  </button>
                )
              })}
            </div>
            <p className="text-caption text-muted-foreground/80">
              This model's own levels - the composer offers exactly these, with Default first.
            </p>
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-1.5">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-muted-foreground">Context window</span>
              <TextField
                value={contextWindow}
                onChange={(value) => {
                  touched.current.add('contextWindow')
                  setContextWindow(value)
                }}
                placeholder="unknown"
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-caption text-muted-foreground">Max output tokens</span>
              <TextField
                value={maxOutputTokens}
                onChange={(value) => {
                  touched.current.add('maxOutputTokens')
                  setMaxOutputTokens(value)
                }}
                placeholder="unknown"
              />
            </label>
          </div>
          {/* The consequence, stated where the choice is made. Compaction
              stands on the window: without one the meter has no percentage,
              and Studio can only compact once the provider has refused. */}
          {windowEmpty ? (
            <p className="text-caption text-muted-foreground/80">
              Without a context window the meter shows no percentage, and a long conversation is
              compacted only once the provider refuses a request.
            </p>
          ) : null}
        </div>

        {failure ? (
          <p role="alert" className="text-caption text-danger">
            {failure.message}
          </p>
        ) : null}
      </div>
    </Dialog>
  )
}
