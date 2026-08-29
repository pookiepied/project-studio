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
  reasoningChoiceNote,
  type CatalogModel,
} from '@/domain/models/catalog'
import { REASONING_LEVEL_NOTES, type ReasoningChoice } from '@/domain/models/types'
import { effectiveTurnSettings } from '@/domain/session/settings'
import { loadRecentModelIds, rememberRecentModel } from '@/domain/session/recents'
import { ModelLibraryDialog } from '@/features/models/ModelLibraryDialog'
import { CatalogStateNote } from '@/features/models/CatalogStateNote'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * The turn settings: one pill, one menu, and a library on its own page.
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
 * ---- What the first level shows, and why not everything --------------------
 *
 * There was a time this menu listed every model of every connection, and then
 * a time it opened a small library beside the strip. Against an aggregator
 * connection neither works: hundreds of rows in a column that used to be a
 * shortcut, and the facts that distinguish them - price, context, capability -
 * with nowhere to appear. So the first level holds only what a decision
 * actually needs: the harness's default, the models already picked recently,
 * and the door to the library - which is a dialog of its own now, wide enough
 * to show a list and a detail pane, where choosing is an explicit act with a
 * button rather than a row click that might have been an accident.
 *
 * "Recent" is deliberately not an "auto" mode - Studio is nobody's first-party
 * client and invents no model; the resting choice remains the harness's own
 * default until the user names one, and the recents are only the names the
 * user has already chosen, kept to three so the section stays a shortcut
 * rather than growing a second library. Until a model is named, the pill says
 * "Choose a model" rather than dressing the default up as a selection.
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

type View = 'root' | 'reasoning'

export function TurnMenu() {
  const { settings, setSettings, setConversationSettings, conversations, catalog } =
    useWorkspace()
  const { route, openSettings } = useNavigation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('root')
  const [libraryOpen, setLibraryOpen] = useState(false)

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

  const chooseModel = (modelId: string | null, reasoningLevel: ReasoningChoice = effective.reasoningLevel) => {
    // Only an explicit pick counts as recent - the harness's default is the
    // resting state, not a choice the user made, and recording it would put a
    // row that resolves to whatever the defaults name into a list of names.
    if (modelId !== null) rememberRecentModel(modelId)
    if (active !== null) {
      setConversationSettings(active.id, { modelId, reasoningLevel })
    } else {
      setSettings({ ...settings, modelId, reasoningLevel })
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

  // Not "Studio default": until a model is named, nothing is selected, and a
  // pill that reads as a selection is a pill that lies. This is the one place
  // that says what to do about it.
  const label = model?.name ?? 'Choose a model'

  return (
    <>
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="bottom"
        align="end"
        className="studio-scroll-bounded max-h-[28rem] w-80 overflow-y-auto"
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
              <Icons.disclosure state={open ? 'on' : 'rest'} className="opacity-60" />
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
              setLibraryOpen(true)
            }}
            reasoningLabel={reasoningLabel(model, effective.reasoningLevel)}
            hasReasoningControl={model !== undefined && model.reasoningLevels.length > 0}
          />
        )}
      </Popover>

      <ModelLibraryDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        catalog={catalog}
        onUse={(modelId, reasoningLevel) => chooseModel(modelId, reasoningLevel)}
        onOpenSettings={() => {
          setLibraryOpen(false)
          openSettings('providers')
        }}
      />
    </>
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

/** The dial's steps for one model: the provider's own default, then the levels
 * that model actually supports, in Pi's own order. Shared by the two places a
 * reasoning dial appears, so they can never disagree about what it offers. */
function reasoningSteps(model: CatalogModel | undefined) {
  return [
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
  if (catalog.phase.status !== 'ready') {
    return <CatalogStateNote catalog={catalog} />
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

  // Only picks that still resolve to a catalog row are offered. A model that
  // was removed since it was last chosen simply stops appearing here; the
  // remembered name is a shortcut, not a record the picker has to honour.
  const recent = loadRecentModelIds()
    .map((id) => findCatalogModel(catalog.models, id))
    .filter((entry): entry is CatalogModel => entry !== undefined)

  return (
    <>
      <MenuItem selected={selected === null} onSelect={() => onChoose(null)}>
        Default model
      </MenuItem>

      {recent.length > 0 ? (
        <>
          <MenuSeparator />
          <MenuLabel>Recent</MenuLabel>
          {recent.map((candidate) => (
            <MenuItem
              key={candidate.id}
              selected={candidate.id === selected}
              onSelect={() => onChoose(candidate.id)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <ProviderMark provider={candidate.author} className="opacity-80" />
                <span className="min-w-0 truncate">{candidate.name}</span>
              </span>
            </MenuItem>
          ))}
        </>
      ) : null}

      {/* Where everything else lives: the full catalog, with search and the
          facts about each model, one step away. A picker is for choosing;
          browsing two hundred rows is a different activity and gets a page
          that can hold it. */}
      <MenuSeparator />
      <MenuItem icon={<Icons.search />} onSelect={onOpenLibrary}>
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
  const steps = reasoningSteps(model)
  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-ui text-muted-foreground hover:bg-tint"
      >
        {/* Pointing back the way it came. The same mark the disclosures
            use, turned — one idea of "there is more this way". */}
        <Icons.disclosure className="rotate-180" />
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
