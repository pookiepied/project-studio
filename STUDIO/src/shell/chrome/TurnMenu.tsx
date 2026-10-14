import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { CatalogStateNote, ModelLibraryDialog, ProviderMark } from '@/features/models'
import {
  MenuItem,
  MenuLabel,
  MenuSeparator,
  MenuViews,
  Popover,
  StepSlider,
  Tooltip,
} from '@/components/primitives'
import { findCatalogModel, resolveTurnModel, type CatalogModel } from '@/domain/models/catalog'
import {
  REASONING_LEVEL_NOTES,
  restingReasoningLevel,
  type ReasoningChoice,
} from '@/domain/models/types'
import {
  contextBreakdown,
  formatTokens,
  type ContextBreakdown,
  type ContextReport,
} from '@/domain/turn/context'
import { effectiveTurnSettings } from '@/domain/turn/settings'
import { loadRecentModelIds, rememberRecentModel } from '@/domain/models/recents'
import { ContextDetails, ContextTank } from '@/shell/chrome/ContextTank'
import { useNavigation } from '@/stores/navigation'
import { useLiveWork, useWorkspace } from '@/stores/workspace'
import { useCompactNow } from '@/features/chat/compaction/useCompactNow'
import {
  createHarnessClient,
  resolveHarnessAddress,
  type CompactionReadiness,
} from '@/platform/harness'
import { cn } from '@/lib/cn'
import { capital } from '@/lib/text'

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
 * the door to the library - which is a dialog of its own now, organised as
 * families first and a model's own facts one drill deeper, where choosing is
 * an explicit act with a button rather than a row click that might have been
 * an accident.
 *
 * "Recent" is deliberately not an "auto" mode - Studio is nobody's first-party
 * client and invents no model; the resting choice remains the harness's own
 * default until the user names one, and the recents are only the names the
 * user has already chosen, kept to three so the section stays a shortcut
 * rather than growing a second library. Until a model is named, the pill says
 * "Choose a model" rather than dressing the default up as a selection.
 *
 * ---- Why the context lives here --------------------------------------------
 *
 * Because a fill is a fraction, and the model is its denominator. Shown apart
 * - as the ring in the strip was - "42k" is a number with nothing to compare
 * it against, and the reader has to remember which model is selected to know
 * whether that is a tenth of the window or nearly all of it. Shown here, the
 * name, the window and the fill are one statement, and the control that
 * changes the denominator is directly under the bar it changes.
 *
 * It also settles what the strip should carry at rest: nothing but the
 * percentage, in the pill's own words, once it is news. Two small circles
 * side by side - a provider's mark and a meter ring - is one circle too many
 * for a corner meant to read as a label.
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

/** A conversation the page has said nothing about yet: nothing measured. */
const EMPTY_REPORT: ContextReport = { measured: null, pending: 0 }

export function TurnMenu() {
  const {
    settings,
    setSettings,
    setConversationSettings,
    conversations,
    catalog,
    ensureStore,
  } = useWorkspace()
  const { contextReports, running, contextRevisions } = useLiveWork()
  const { compacting, compactNow: compact } = useCompactNow()
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
  // What this surface is actually sending with. A conversation that named no
  // model is not modelless - the harness sends it under the stable alias,
  // which resolves to the Chat default from Settings - so the picker resolves
  // the same way rather than reporting an absence that is not there.
  const { model, following } = resolveTurnModel(catalog, effective.modelId)

  // Measured against the model this surface would actually send with, which
  // is the same derivation the label above uses - so the fill and the name it
  // is drawn under can never disagree.
  //
  // Only on a conversation: home and a project have a composer but no
  // transcript, so there is no window to be part-full. The report comes from
  // the open conversation's own page, the only thing that can see its items.
  const breakdown =
    active === null
      ? null
      : contextBreakdown(
          contextReports.get(active.id) ?? EMPTY_REPORT,
          model?.contextWindow ?? null,
          model?.capability.maxOutputTokens ?? null,
        )
  const turnRunning = active !== null && running.has(active.id)

  // Reopening lands on the top level. A menu that remembers it was left on a
  // sub-page reopens showing something other than what its trigger describes.
  useEffect(() => {
    if (!open) setView('root')
  }, [open])

  // Whether "Compact now" may run, asked when the menu opens and again after
  // anything that changes the answer - a turn ending, a compaction. The
  // harness decides (the cool-down lives there, beside the threshold), and
  // the control shows the sentence it answers with.
  const [readiness, setReadiness] = useState<CompactionReadiness | null>(null)
  const [compactError, setCompactError] = useState<string | null>(null)
  const activeId = active?.id ?? null
  const isCompacting = activeId !== null && compacting.has(activeId)
  const revision = activeId === null ? 0 : (contextRevisions.get(activeId) ?? 0)
  useEffect(() => {
    if (!open || activeId === null) return
    let watching = true
    void (async () => {
      const address = await resolveHarnessAddress()
      if (address === null || !watching) return
      const result = await createHarnessClient(address).conversationCompaction(activeId)
      if (!watching) return
      setReadiness(result.ok ? result.value : null)
    })()
    return () => {
      watching = false
    }
  }, [open, activeId, turnRunning, revision, isCompacting])

  const compactNow = () => {
    if (activeId === null || isCompacting) return
    setCompactError(null)
    void compact(activeId).then(setCompactError)
  }

  const chooseModel = (
    modelId: string | null,
    reasoningLevel: ReasoningChoice | null = effective.reasoningLevel,
  ) => {
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

  // The one thing the strip still says about the window at rest, and only
  // when it has become worth saying. Below this the number is a figure nobody
  // needs; above it, it changes what you do next.
  const percent = breakdown === null || breakdown.report.measured?.estimated === true
    ? null : Math.round(breakdown.used * 100)
  const warn = percent !== null && percent >= 60

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
            label={[
              label,
              reasoningLabel(model, effective.reasoningLevel),
              percent === null ? null : `${percent}% of the context window used`,
            ]
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
                  places.

                  Mark and name change together and are keyed on the model, so
                  a pick replaces them as one thing and the replacement
                  arrives with a small rise. Swapped in a single frame it read
                  as the label merely being different, with nothing tying the
                  new words to the click - and on a truncated name the only
                  visible change can be two letters before the ellipsis.

                  Keyed remount rather than an `AnimatePresence` crossover, and
                  that was tried first: `mode="wait"` holds the new name back
                  until the old one had finished leaving, which empties the
                  label for a beat and delays the answer to the question just
                  asked. Overlapping the two instead needs the outgoing name
                  taken out of flow, which fights the truncation this label
                  depends on. The new name appearing at once and settling in is
                  both the simpler construction and the more honest one: the
                  choice took effect immediately, so it should say so.

                  Under the strip's fold-to-mark breakpoint the words stand
                  down and the mark is the whole control: a phone cannot give
                  this pill its worst-case width and the centred title theirs,
                  and the strip's own arithmetic (see `TopStrip`) is what
                  decides where that line falls. The name is not lost - it is
                  the trigger's tooltip and the menu's first row. */}
              <motion.span
                key={model?.id ?? label}
                initial={{ opacity: 0, y: -3 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: DURATION.fast, ease: EASE_OUT }}
                className="flex min-w-0 items-center gap-1.5"
              >
                {model ? <ProviderMark provider={model.author} className="shrink-0" /> : null}
                <span className="min-w-0 truncate @max-[48rem]:hidden">{label}</span>
              </motion.span>
              {warn ? (
                <span className="shrink-0 tabular-nums text-muted-foreground @max-[48rem]:hidden">
                  {percent}%
                </span>
              ) : null}
              <Icons.dropdown className="opacity-60" />
            </button>
          </Tooltip>
        }
      >
        <MenuViews view={view} depth={view === 'root' ? 0 : 1}>
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
            model={model}
            selected={effective.modelId}
            breakdown={breakdown}
            running={turnRunning}
            onChoose={chooseModel}
            onOpenReasoning={() => setView('reasoning')}
            onOpenLibrary={() => {
              setOpen(false)
              setLibraryOpen(true)
            }}
            reasoningLabel={reasoningLabel(model, effective.reasoningLevel)}
            hasReasoningControl={model !== undefined && model.reasoningLevels.length > 0}
            following={following}
            compaction={
              activeId === null
                ? null
                : { readiness, compacting: isCompacting, error: compactError, onCompact: compactNow }
            }
          />
        )}
        </MenuViews>
      </Popover>

      <ModelLibraryDialog
        open={libraryOpen}
        onClose={() => setLibraryOpen(false)}
        catalog={catalog}
        onUse={(modelId, reasoningLevel) => chooseModel(modelId, reasoningLevel)}
        onOpenSettings={() => {
          setLibraryOpen(false)
          openSettings('models')
        }}
        onEnsure={ensureStore}
      />
    </>
  )
}

/** The reasoning line the trigger's tooltip and the menu item show. */
function reasoningLabel(
  model: CatalogModel | undefined,
  choice: ReasoningChoice | null,
): string | null {
  // A model with no levels has no reasoning control to summarize; naming a
  // level beside it would advertise a dial that is not there.
  if (model !== undefined && model.reasoningLevels.length === 0) return null
  if (model === undefined && choice === null) return null
  const shown = choice ?? restingFor(model)
  return shown === null ? null : capital(shown)
}

/** The dial's resting level for one model: medium when it has it, otherwise
 * the nearest supported level. Null when no model is named, which is the
 * state with no dial to rest. */
function restingFor(model: CatalogModel | undefined): ReasoningChoice | null {
  if (model === undefined || model.reasoningLevels.length === 0) return null
  return restingReasoningLevel(model.reasoningLevels)
}

/** The dial's steps for one model: only the levels that model actually
 * supports, in Pi's own order. Shared by the two places a reasoning dial
 * appears, so they can never disagree about what it offers. */
function reasoningSteps(model: CatalogModel | undefined) {
  return (model?.reasoningLevels ?? []).map((level) => {
    const note = REASONING_LEVEL_NOTES.find((entry) => entry.id === level)
    return {
      id: level,
      name: note?.name ?? capital(level),
      note: note?.note,
    }
  })
}

function ModelPanel({
  catalog,
  model,
  selected,
  breakdown,
  running,
  reasoningLabel,
  hasReasoningControl,
  following,
  onChoose,
  onOpenReasoning,
  onOpenLibrary,
  compaction,
}: {
  catalog: ReturnType<typeof useWorkspace>['catalog']
  model: CatalogModel | undefined
  selected: string | null
  /** Null off a conversation: a composer with no transcript has no window. */
  breakdown: ContextBreakdown | null
  running: boolean
  reasoningLabel: string | null
  hasReasoningControl: boolean
  /** The model came from the Settings default, not from a pick made here. */
  following: boolean
  onChoose: (modelId: string | null) => void
  onOpenReasoning: () => void
  onOpenLibrary: () => void
  /** "Compact now", on a conversation: whether it may run, and the action. Null off one. */
  compaction: {
    readiness: CompactionReadiness | null
    compacting: boolean
    error: string | null
    onCompact: () => void
  } | null
}) {
  const [detailed, setDetailed] = useState(false)

  // Whether anything at all stands above the model list. A separator is a
  // rule BETWEEN two things, so with nothing above it, it is a line ruled
  // across the top of the menu against the panel's own edge - which reads as
  // a header with no header in it. That is what a conversation with no model
  // named and no reasoning control was showing.
  const head = model !== undefined || breakdown !== null

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
  // Only picks that still resolve to a catalog row. A model that was removed
  // since it was last chosen simply stops appearing here; the remembered name
  // is a shortcut, not a record the picker has to honour.
  //
  // The one in force is deliberately NOT filtered out, though it was for a
  // day. These rows and "Default model" are one radio group over a single
  // question - what does this turn ride - and a group whose current answer is
  // removed from it can never draw its own check. The column then sits empty
  // on every recent for ever, which is a reserved space that means nothing,
  // and picking a row you were already on stops being confirmable. An empty
  // check beside a row that COULD carry one says "not this one", which is the
  // ordinary and useful thing; an empty check beside a row that never can is
  // just an indent.
  const recent = loadRecentModelIds()
    .map((id) => findCatalogModel(catalog.models, id))
    .filter((entry): entry is CatalogModel => entry !== undefined)

  return (
    <>
      {/* The head of the menu is the answer to "what am I sending, and how
          much room is left in it". The model names itself, its window sits
          under the name, and the bar is drawn against that window - one
          statement rather than a name here and a fraction somewhere else. */}
      {/* Present whenever there is a turn to describe, named or not. A
          conversation riding the harness's default has a window being filled
          like any other, and hiding the bar until someone names a model would
          leave exactly the people who never open this menu with no way to see
          it. The name says what is true instead: nothing is chosen yet. */}
      {head ? (
        <div className="flex flex-col gap-2.5 px-2 pb-1 pt-1.5">
          <div className="flex min-w-0 items-center gap-2">
            {model === undefined ? null : (
              <ProviderMark provider={model.author} className="shrink-0" />
            )}
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-ui text-foreground">
                {model?.name ?? 'No model chosen'}
              </span>
              <span className="text-micro text-muted-foreground">
                {model === undefined
                  ? `Nothing is set as the Chat default, so the harness decides and ${formatTokens(breakdown?.window ?? 0)} stands in for its window.`
                  : model.contextWindow === 'unknown'
                    ? 'Context window not declared'
                    : `${formatTokens(model.contextWindow)} context window`}
              </span>
            </span>
          </div>

          {/* Said here and not in the pill. The pill answers "what am I
              talking to", and the model's name is that answer whichever way
              it was arrived at. HOW it was arrived at is a different question
              with a different consequence - change the Chat default tomorrow
              and every following conversation moves with it - and it belongs
              next to the control that would change it. */}
          {following && model !== undefined ? (
            <p className="text-micro text-muted-foreground/80">
              Following the Chat default. Picking a model below pins this
              conversation to it instead.
            </p>
          ) : null}

          {/* The window's consequences, said before the next message is sent
              rather than as the error after it. A conversation larger than
              the model just picked is compacted on that message - the
              request overflows, the runtime compacts and retries once - and
              the person should choose knowing. A model with no window has no
              percentage to draw and no threshold to compact at; the provider's
              refusal is the only trigger left. */}
          {breakdown !== null && model !== undefined && breakdown.windowDeclared && breakdown.total > breakdown.window ? (
            <p className="text-micro text-foreground">
              This conversation is larger than this model's window. It will be
              compacted on the next message.
            </p>
          ) : breakdown !== null && model !== undefined && !breakdown.windowDeclared ? (
            <p className="text-micro text-muted-foreground/80">
              The meter stands in {formatTokens(breakdown.window)} for the window, and the
              conversation is compacted only once the provider refuses a request.
            </p>
          ) : null}

          {breakdown === null ? null : (
            <>
              <ContextTank breakdown={breakdown} running={running} />
              <button
                type="button"
                onClick={() => setDetailed((current) => !current)}
                aria-expanded={detailed}
                className="flex items-center gap-1 self-start text-micro text-muted-foreground transition-colors duration-fast hover:text-foreground"
              >
                <Icons.disclosure state={detailed ? 'on' : 'rest'} />
                {detailed ? 'Hide breakdown' : 'Breakdown'}
              </button>
              {detailed ? <ContextDetails breakdown={breakdown} /> : null}
            </>
          )}
        </div>
      ) : null}

      {/* The dial, in the open rather than behind a row: it is the second
          thing about this turn, and a setting you adjust by feel should not
          cost a page turn to reach. The sub-view survives for the notes each
          step carries, which do not fit here. */}
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

      {/* Compacting by hand, beside the meter it empties. Present whenever
          the harness offers it, and disabled with the harness's own sentence
          when the cool-down or a running turn refuses it - the reason is
          the useful part, and a control that vanished would not carry it. */}
      {compaction !== null && compaction.readiness !== null ? (
        <>
          {hasReasoningControl ? null : <MenuSeparator />}
          <MenuItem
            icon={<Icons.compaction />}
            disabled={compaction.compacting || running || !compaction.readiness.available}
            onSelect={compaction.onCompact}
          >
            {compaction.compacting ? 'Compacting…' : 'Compact now'}
          </MenuItem>
          {/* The reason under the row, not as its hint: a sentence beside
              the label pushed the label out of a menu this narrow. */}
          {compaction.compacting ? null : running ? (
            <p className="px-2 pb-1 pl-8 text-micro text-muted-foreground/80">
              Finish or stop the run first.
            </p>
          ) : compaction.readiness.available ? null : (
            <p className="px-2 pb-1 pl-8 text-micro text-muted-foreground/80">
              {compaction.readiness.reason}
            </p>
          )}
          {compaction.error !== null ? (
            <p role="alert" className="px-2 pb-1 pl-8 text-micro text-danger">
              {compaction.error}
            </p>
          ) : null}
        </>
      ) : null}

      {head || hasReasoningControl || compaction?.readiness ? <MenuSeparator /> : null}
      <MenuItem selected={selected === null} onSelect={() => onChoose(null)}>
        Default model
      </MenuItem>

      {recent.length > 0 ? (
        <>
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
      <MenuItem icon={<Icons.library />} onSelect={onOpenLibrary}>
        Model library…
      </MenuItem>
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
  choice: ReasoningChoice | null
  onBack: () => void
  onChange: (choice: ReasoningChoice) => void
}) {
  const steps = reasoningSteps(model)
  const resting = restingFor(model) ?? 'medium'
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
        value={choice !== null && steps.some((step) => step.id === choice) ? choice : resting}
        onChange={onChange}
      />
    </>
  )
}

/** A single quiet line where a list would have been. */
function MenuNote({ children }: { children: React.ReactNode }) {
  return <p className="px-2 py-2 text-ui text-muted-foreground">{children}</p>
}
