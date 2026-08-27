import { useEffect, useState } from 'react'
import { Icons, ProviderMark } from '@/components/icons'
import {
  MenuItem,
  MenuLabel,
  MenuSeparator,
  Popover,
  StepSlider,
  Tooltip,
} from '@/components/primitives'
import {
  findCatalogModel,
  groupCatalog,
  reasoningChoiceNote,
  type CatalogModel,
} from '@/domain/models/catalog'
import { REASONING_LEVEL_NOTES, type ReasoningChoice } from '@/domain/models/types'
import { effectiveTurnSettings } from '@/domain/session/settings'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * The turn settings: one pill, one menu, two depths.
 *
 * ---- Why it is one control again -------------------------------------------
 *
 * This was briefly three segments in a bordered capsule with dividers between
 * them. That solved the right problem — a single scrolling column cannot hold
 * a model library plus two settings — and introduced a worse one: a bordered,
 * divided container in the top strip reads as a toolbar, and a toolbar is the
 * developer-tool look this app is defined against. Three outlines and two rules
 * where there had been one quiet word is more furniture, not less.
 *
 * So the separation moved inside. One borderless pill, one menu, and the menu
 * has a second level for the setting that needs room. Nothing on the strip
 * changed shape; the depth is behind a click, which is where depth belongs.
 *
 * ---- Where the models come from --------------------------------------------
 *
 * From the harness - the catalog `GET /api/providers/models` serves, which is
 * the same list the settings pages manage. The picker offers exactly what the
 * harness says it can serve: no harness, no connections, or a failed read are
 * named states, because six models that do not exist are worse than a sentence
 * that says why the list is empty.
 *
 * ---- Why reasoning is a slider ---------------------------------------------
 *
 * Because it is the one setting here that is a dial rather than a choice. The
 * steps are ordered and adjacent ones are near-equivalent: nobody wants "high"
 * specifically, they want "more than medium". A track is the same control at
 * any length; a list of rows changes height and position every time the model
 * changes, moving the setting out from under the pointer that was adjusting it.
 * The steps themselves come from the selected model - a model with no
 * reasoning support offers no control at all, rather than one that does
 * nothing.
 */
export function TurnMenu() {
  const { settings, setSettings, setConversationSettings, conversations, catalog } =
    useWorkspace()
  const { route, openSettings } = useNavigation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'root' | 'reasoning'>('root')

  // The choice a turn from THIS surface will carry: the conversation's own
  // settled model when it has one, the window's otherwise. The send paths use
  // the same derivation, so the display and the request cannot disagree.
  const active =
    route.kind === 'chat'
      ? conversations.find((item) => item.id === route.conversationId) ?? null
      : null
  const effective = effectiveTurnSettings(active, settings)
  const model = findCatalogModel(catalog.models, effective.modelId)

  // Reopening lands on the top level. A menu that remembers it was left on a
  // sub-page reopens showing something other than what its trigger describes.
  useEffect(() => {
    if (!open) setView('root')
  }, [open])

  const chooseModel = (modelId: string | null) => {
    if (active !== null) {
      setConversationSettings(active.id, {
        modelId,
        reasoningLevel: effective.reasoningLevel,
      })
    } else {
      setSettings({ ...settings, modelId })
    }
    setOpen(false)
  }

  const chooseReasoning = (reasoningLevel: ReasoningChoice) => {
    if (active !== null) {
      setConversationSettings(active.id, {
        modelId: effective.modelId,
        reasoningLevel,
      })
    } else {
      setSettings({ ...settings, reasoningLevel })
    }
  }

  const label = model?.name ?? 'Studio default'

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="studio-scroll-bounded max-h-[28rem] w-72 overflow-y-auto"
      trigger={
        <Tooltip
          label={[label, reasoningLabel(model, effective.reasoningLevel)]
            .filter(Boolean)
            .join(' · ')}
          side="bottom"
        >
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label="Turn settings"
            className={cn(
              // No border, no dividers, no fill at rest. The strip holds the
              // window's identity; this is a label that happens to be clickable.
              'flex max-w-56 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui',
              'text-muted-foreground transition-colors duration-fast',
              open ? 'bg-selected text-foreground' : 'hover:bg-tint',
            )}
          >
            {/* The model's own mark, not the connection's: a model reached
                through OpenRouter wears its author's mark here, and the
                connection wears OpenRouter's in Settings. Two facts, two
                places. */}
            {model ? <ProviderMark provider={model.author} className="shrink-0" /> : null}
            <span className="min-w-0 truncate">{label}</span>
            <Icons.disclosure state={open ? 'on' : 'rest'} className="shrink-0 opacity-60" />
          </button>
        </Tooltip>
      }
    >
      {view === 'reasoning' ? (
        <ReasoningPanel
          model={model}
          choice={effective.reasoningLevel}
          onBack={() => setView('root')}
          onChange={chooseReasoning}
        />
      ) : (
        <ModelPanel
          catalog={catalog}
          selected={effective.modelId}
          onChoose={chooseModel}
          onOpenReasoning={() => setView('reasoning')}
          onOpenLibrary={() => {
            setOpen(false)
            openSettings('providers')
          }}
          reasoningLabel={reasoningLabel(model, effective.reasoningLevel)}
          hasReasoningControl={model !== undefined && model.reasoningLevels.length > 0}
        />
      )}
    </Popover>
  )
}

/** The reasoning line the trigger's tooltip and the menu item show. */
function reasoningLabel(model: CatalogModel | undefined, choice: ReasoningChoice): string | null {
  // A model with no levels has no reasoning control to summarize; naming a
  // level beside it would advertise a dial that is not there.
  if (model !== undefined && model.reasoningLevels.length === 0) return null
  if (choice === 'default' && model === undefined) return null
  return choice === 'default' ? 'Default reasoning' : capital(choice)
}

function capital(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function ModelPanel({
  catalog,
  selected,
  reasoningLabel,
  hasReasoningControl,
  onChoose,
  onOpenReasoning,
  onOpenLibrary,
}: {
  catalog: ReturnType<typeof useWorkspace>['catalog']
  selected: string | null
  reasoningLabel: string | null
  hasReasoningControl: boolean
  onChoose: (modelId: string | null) => void
  onOpenReasoning: () => void
  onOpenLibrary: () => void
}) {
  if (catalog.phase.status === 'loading') {
    return <MenuNote>Reading models...</MenuNote>
  }
  if (catalog.phase.status === 'no-harness') {
    return (
      <MenuNote>No harness is running, so there are no models to choose yet.</MenuNote>
    )
  }
  if (catalog.phase.status === 'failed') {
    return (
      <MenuNote>
        Could not read the model catalog. {catalog.phase.error?.message ?? ''}
      </MenuNote>
    )
  }
  if (catalog.models.length === 0) {
    // The state a new install is in, said once, pointing at the one place
    // that fixes it - not an error, and not a nag.
    return (
      <>
        <MenuNote>
          No connections yet. Add one in Settings to give Studio somewhere to send a request.
        </MenuNote>
        <MenuItem icon={<Icons.settings />} onSelect={onOpenLibrary}>
          Open Settings
        </MenuItem>
      </>
    )
  }

  const defaultsGroup = groupCatalog(catalog.models)
  return (
    <>
      <MenuItem selected={selected === null} onSelect={() => onChoose(null)}>
        Studio default
      </MenuItem>

      <MenuSeparator />

      {defaultsGroup.map((group) => (
        <div key={group.connectionId}>
          {/* The connection's mark sits with its name, once, rather than on
              every model beneath it. Repeating a logo down a group says the
              rows differ by provider when what differs is the model. The
              mark shown is the CONNECTION's vendor; each model under it
              carries its own author's mark. */}
          <MenuLabel>
            <span className="flex items-center gap-1.5">
              <ProviderMark provider={group.connectionVendor} />
              {group.connectionName}
            </span>
          </MenuLabel>
          {group.models.map((candidate) => (
            <MenuItem
              key={candidate.id}
              selected={candidate.id === selected}
              onSelect={() => onChoose(candidate.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {/* The model's own author - Anthropic's mark on a model
                    reached through OpenRouter. The distinction is the
                    point: this row answers "whose model", the group header
                    answers "through whom". */}
                <ProviderMark provider={candidate.author} className="opacity-80" />
                <span className="min-w-0 truncate">{candidate.name}</span>
              </span>
            </MenuItem>
          ))}
        </div>
      ))}

      {/* Where a user's own models arrive from, rather than letting them
          swell this list. A picker is for choosing; adding is a different
          activity and needs a page that can hold a key, a base URL and a wire
          format without becoming a menu. */}
      <MenuItem icon={<Icons.mcp />} onSelect={onOpenLibrary}>
        Model library…
      </MenuItem>

      {/* Absent entirely for a model with no reasoning support - present and
          inert would be a control that lies. */}
      {hasReasoningControl ? (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<Icons.reasoning />}
            hint={reasoningLabel ?? undefined}
            onSelect={onOpenReasoning}
          >
            Reasoning
          </MenuItem>
        </>
      ) : null}
    </>
  )
}

function ReasoningPanel({
  model,
  choice,
  onBack,
  onChange,
}: {
  model: CatalogModel | undefined
  choice: ReasoningChoice
  onBack: () => void
  onChange: (choice: ReasoningChoice) => void
}) {
  // "default" first - the provider's own behaviour, which is a real choice -
  // then the levels this one model actually supports, in Pi's own order.
  const steps = [
    { id: 'default' as const, name: 'Default', note: reasoningChoiceNote('default') },
    ...(model?.reasoningLevels ?? []).map((level) => {
      const note = REASONING_LEVEL_NOTES.find((entry) => entry.id === level)
      return {
        id: level,
        name: note?.name ?? capital(level),
        note: note?.note,
      }
    }),
  ]

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-ui text-muted-foreground hover:bg-tint"
      >
        {/* Pointing back the way it came. The same mark the disclosures
            use, turned — one idea of "there is more this way". */}
        <Icons.disclosure className="shrink-0 rotate-180" />
        Reasoning
      </button>
      <MenuSeparator />
      <StepSlider
        steps={steps}
        value={steps.some((step) => step.id === choice) ? choice : 'default'}
        onChange={onChange}
      />
    </>
  )
}

/** A single quiet line where a list would have been. */
function MenuNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-2 text-ui text-muted-foreground">{children}</p>
}
