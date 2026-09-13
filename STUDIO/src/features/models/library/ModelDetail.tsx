import { Icons } from '@/components/icons'
import { ProviderMark } from '@/features/models/ProviderMark'
import { NavRow, StepSlider } from '@/components/primitives'
import type { CatalogModel } from '@/domain/models/catalog'
import { familyName } from '@/domain/models/families'
import {
  REASONING_LEVEL_NOTES,
  restingReasoningLevel,
  type ReasoningChoice,
} from '@/domain/models/types'
import { contextFull, priceFull } from './format'
import { cn } from '@/lib/cn'
import { capital } from '@/lib/text'

/**
 * A model's own page: everything the wire record says, in reading order.
 *
 * ---- What is here, and in what order ---------------------------------------
 *
 * The page answers one question at a time, top to bottom: where am I (the
 * back row and the mark), what is this (the name), how much does it hold and
 * cost (the stat grid), what can it do (the capability chips), how hard can
 * it think (the dial), and finally the record itself - the id a request
 * actually carries, quiet at the bottom because it is metadata, not a
 * decision.
 *
 * ---- Why a page and not the old side panel ---------------------------------
 *
 * The old details sat in a permanently present right pane that scrolled with
 * the page underneath it and, before a model was chosen, waited empty. A
 * pane whose normal state is "nothing yet" is a hole in the layout; a page
 * is only ever reached when there is something in it. That is the whole
 * argument for the drill-in: the library has no empty state to design
 * because no level exists before its content does.
 */
export function ModelDetail({
  model,
  backLabel,
  reasoningLevel,
  onReasoning,
  onBack,
}: {
  model: CatalogModel
  /** Where the back row returns to, named rather than labelled "Back". */
  backLabel: string
  reasoningLevel: ReasoningChoice | null
  onReasoning: (level: ReasoningChoice) => void
  onBack: () => void
}) {
  const levels = model.reasoningLevels.map((level) => {
    const note = REASONING_LEVEL_NOTES.find((entry) => entry.id === level)
    return { id: level, name: note?.name ?? capital(level), note: note?.note }
  })
  const resting = restingReasoningLevel(model.reasoningLevels)
  const shown = reasoningLevel !== null && levels.some((step) => step.id === reasoningLevel)
    ? reasoningLevel
    : resting

  return (
    <div className="flex flex-col gap-5 py-1">
      {/* Pointing back the way it came - the same turned mark every
          disclosure uses, so back reads as back and not as decoration. */}
      <NavRow icon={<Icons.disclosure className="rotate-180" />} className="w-fit" onClick={onBack}>
        {backLabel}
      </NavRow>

      <header className="flex items-start gap-3 px-2">
        <span className="flex h-[1lh] items-center text-title">
          <ProviderMark provider={model.author} size="lg" className="relative" />
        </span>
        <div className="min-w-0">
          <h3 className="truncate text-title font-medium text-foreground">{model.name}</h3>
          <p className="truncate text-caption text-muted-foreground">
            by {familyName(model.author)} · via {model.connectionName}
          </p>
        </div>
      </header>

      <section className="grid grid-cols-2 gap-x-8 gap-y-2.5 px-2">
        <Stat label="Context window" value={contextFull(model.contextWindow)} />
        <Stat label="Max output" value={contextFull(model.capability.maxOutputTokens)} />
        <Stat label="Input price" value={priceFull(model.pricing.input)} />
        <Stat label="Output price" value={priceFull(model.pricing.output)} />
        <Stat label="Cache read" value={priceFull(model.pricing.cacheRead)} />
        <Stat label="Cache write" value={priceFull(model.pricing.cacheWrite)} />
      </section>

      <section className="px-2">
        <p className="pb-1.5 text-micro text-muted-foreground">Capabilities</p>
        <div className="flex flex-wrap gap-1.5">
          <Capability name="Streaming" state={model.capability.streaming} />
          <Capability name="Tool calling" state={model.capability.toolCalling} />
          <Capability name="Vision" state={model.capability.vision} />
          <Capability name="Reasoning" state={model.capability.reasoning} />
          {/* Web reach is rare on a language model, so it only claims a chip
              when the provider described it - an always-muted "web search ?"
              on every row would be noise, not information. */}
          {model.capability.webSearch !== 'unsupported' ? (
            <Capability name="Web search" state={model.capability.webSearch} />
          ) : null}
          {model.capability.webFetch !== 'unsupported' ? (
            <Capability name="Web fetch" state={model.capability.webFetch} />
          ) : null}
        </div>
      </section>

      {/* Absent entirely for a model with no reasoning support - present and
          inert would be a control that lies. */}
      {levels.length > 0 ? (
        <section className="px-2">
          <p className="pb-1 text-micro text-muted-foreground">Reasoning effort</p>
          <StepSlider steps={levels} value={shown} onChange={onReasoning} />
        </section>
      ) : null}

      <section className="border-t px-2 pt-3">
        <p className="text-caption text-muted-foreground">
          Sent as <span className="font-mono">{model.id}</span>
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-caption text-muted-foreground">{label}</p>
      <p className="truncate text-ui tabular-nums text-foreground">{value}</p>
    </div>
  )
}

function Capability({
  name,
  state,
}: {
  name: string
  state: 'supported' | 'unsupported' | 'unknown'
}) {
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

