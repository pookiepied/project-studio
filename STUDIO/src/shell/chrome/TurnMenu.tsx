import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { DURATION, EASE_OUT } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { ProviderMark } from '@/features/models'
import { ModelPicker, ModelProviders } from '@/features/models/ModelPicker'
import { MenuItem, MenuSeparator, MenuViews, Popover, StepSlider, Tooltip } from '@/components/primitives'
import { resolveTurnModel, type CatalogModel } from '@/domain/models/catalog'
import { REASONING_LEVEL_NOTES, restingReasoningLevel, type ReasoningChoice } from '@/domain/models/types'
import { contextBreakdown, formatTokens, type ContextBreakdown, type ContextReport } from '@/domain/turn/context'
import { effectiveTurnSettings } from '@/domain/turn/settings'
import { rememberRecentModel } from '@/domain/models/recents'
import { ContextCategories, ContextDetails, ContextTank, type ContextBandId } from '@/shell/chrome/ContextTank'
import { useNavigation } from '@/stores/navigation'
import { useLiveWork, useWorkspace } from '@/stores/workspace'
import { useCompactNow } from '@/features/chat/compaction/useCompactNow'
import { createHarnessClient, resolveHarnessAddress, type CompactionReadiness } from '@/platform/harness'
import { cn } from '@/lib/cn'
import { capital } from '@/lib/text'

type View = 'root' | 'reasoning' | 'context'
const EMPTY_REPORT: ContextReport = { measured: null, pending: 0 }

export function TurnMenu({ available = true }: { available?: boolean }) {
  const { settings, setSettings, setConversationSettings, conversations, catalog, ensureStore } = useWorkspace()
  const { contextReports, running, contextRevisions } = useLiveWork()
  const { compacting, compactNow: compact } = useCompactNow()
  const { route, openSettings } = useNavigation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<View>('root')
  const [query, setQuery] = useState('')
  const [browser, setBrowser] = useState<{ connectionId: string | null } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const offered = useMemo(() => catalog.models.filter((candidate) => candidate.offered), [catalog.models])

  // The display and submission resolve the model against the same turn settings.
  const active = route.kind === 'chat'
    ? conversations.find((item) => item.id === route.conversationId) ?? null
    : null
  const effective = effectiveTurnSettings(active, settings)
  const { model, following } = resolveTurnModel(catalog, effective.modelId)
  const breakdown = active === null ? null : contextBreakdown(
    contextReports.get(active.id) ?? EMPTY_REPORT,
    model?.contextWindow ?? null,
    model?.capability.maxOutputTokens ?? null,
  )
  const activeId = active?.id ?? null
  const turnRunning = activeId !== null && running.has(activeId)
  const isCompacting = activeId !== null && compacting.has(activeId)
  const revision = activeId === null ? 0 : (contextRevisions.get(activeId) ?? 0)

  useEffect(() => {
    if (open && available) return
    setOpen(false)
    setView('root')
    setQuery('')
    setBrowser(null)
  }, [open, available])

  const [readiness, setReadiness] = useState<{ conversationId: string; value: CompactionReadiness } | null>(null)
  const [compactError, setCompactError] = useState<{ conversationId: string; message: string } | null>(null)
  useEffect(() => {
    if (!open || !available || view !== 'context' || activeId === null) return
    let watching = true
    void (async () => {
      const address = await resolveHarnessAddress()
      if (address === null || !watching) return
      const result = await createHarnessClient(address).conversationCompaction(activeId)
      if (watching) setReadiness(result.ok && result.value !== null ? { conversationId: activeId, value: result.value } : null)
    })()
    return () => { watching = false }
  }, [open, available, view, activeId, turnRunning, revision, isCompacting])

  const compactNow = () => {
    if (activeId === null || isCompacting) return
    setCompactError(null)
    void compact(activeId).then((message) => {
      if (message !== null) setCompactError({ conversationId: activeId, message })
    })
  }

  const chooseModel = (modelId: string | null) => {
    if (modelId !== null) rememberRecentModel(modelId)
    const target = resolveTurnModel(catalog, modelId).model
    const currentLevel = effective.reasoningLevel
    const reasoningLevel = target !== undefined && currentLevel !== null && !target.reasoningLevels.includes(currentLevel)
      ? null : currentLevel
    if (active !== null) {
      setConversationSettings(active.id, { modelId, reasoningLevel })
    } else {
      setSettings({ ...settings, modelId, reasoningLevel })
    }
    setOpen(false)
    trigger.current?.focus()
  }

  const chooseReasoning = (reasoningLevel: ReasoningChoice) => {
    if (active !== null) {
      setConversationSettings(active.id, { modelId: effective.modelId, reasoningLevel })
    } else {
      setSettings({ ...settings, reasoningLevel })
    }
  }

  const manageProviders = () => {
    setOpen(false)
    openSettings('models')
  }
  const show = (next: View) => {
    setBrowser(null)
    setView(next)
  }

  const label = model?.name ?? 'Choose a model'
  const resting = restingFor(model)
  const level = effective.reasoningLevel !== null && model?.reasoningLevels.includes(effective.reasoningLevel)
    ? effective.reasoningLevel : resting
  const reasoning = resting === null || level === null ? null : reasoningName(level)
  const percent = breakdown === null || breakdown.report.measured?.estimated === true
    ? null : Math.round(breakdown.used * 100)

  return (
    <Popover
      open={open && available}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      maxHeight="28rem"
      className="studio-scroll-bounded w-64 overflow-y-auto overscroll-contain rounded-xl"
      initialFocus='[aria-label="Search models"]'
      companion={view === 'root' && browser !== null && catalog.phase.status === 'ready' && offered.length > 0 ? {
        label: 'More models',
        anchor: '[aria-haspopup="menu"][aria-expanded]',
        content: <ModelProviders
          models={offered}
          connectionId={browser.connectionId}
          selected={effective.modelId}
          onConnection={(connectionId) => setBrowser({ connectionId })}
          onChoose={chooseModel}
          onBack={() => setBrowser(null)}
          onSettings={manageProviders}
        />,
      } : null}
      trigger={
        <Tooltip
          label={[
            label,
            reasoning,
            breakdown === null ? null : `${breakdown.report.measured === null || breakdown.report.measured.estimated || breakdown.report.pending > 0 ? '~' : ''}${breakdown.total.toLocaleString('en-US')} tokens`,
          ].filter(Boolean).join(' · ')}
          side="bottom"
        >
          <button
            ref={trigger}
            type="button"
            onClick={() => setOpen(!open)}
            aria-label="Turn settings"
            aria-haspopup="menu"
            aria-expanded={open}
            className={cn(
              'flex max-w-56 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui',
              'text-muted-foreground transition-colors duration-fast',
              open ? 'bg-selected text-foreground' : 'hover:bg-tint',
            )}
          >
            <motion.span
              key={model?.id ?? label}
              initial={{ opacity: 0, y: -3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: DURATION.fast, ease: EASE_OUT }}
              className="flex min-w-0 items-center gap-1.5"
            >
              {model ? <ProviderMark provider={model.author} bare /> : null}
              <span className="min-w-0 truncate @max-[48rem]:hidden">{label}</span>
            </motion.span>
            {percent !== null && percent >= 60 ? (
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
          <ReasoningPanel model={model} choice={effective.reasoningLevel} onBack={() => show('root')} onChange={chooseReasoning} />
        ) : view === 'context' ? (
          <ContextPanel
            model={model}
            breakdown={breakdown}
            following={following}
            running={turnRunning}
            compacting={isCompacting}
            readiness={readiness?.conversationId === activeId ? readiness.value : null}
            error={compactError?.conversationId === activeId ? compactError.message : null}
            onCompact={compactNow}
            onBack={() => show('root')}
          />
        ) : (
          <ModelPicker
            catalog={catalog}
            models={offered}
            hasConnections={catalog.connections.length > 0}
            selected={effective.modelId}
            query={query}
            browsing={browser !== null}
            onSearch={(value) => { setBrowser(null); setQuery(value) }}
            onChoose={chooseModel}
            onBrowse={() => setBrowser(browser === null ? { connectionId: null } : null)}
            onSettings={manageProviders}
            onRetry={() => { void ensureStore() }}
          >
            {model !== undefined || breakdown !== null ? (
              <>
                <MenuSeparator />
                <MenuItem endIcon={<Icons.disclosure />} onSelect={() => show('context')}>
                  Context window
                </MenuItem>
              </>
            ) : null}
            {reasoning !== null ? (
              <MenuItem icon={<Icons.reasoning />} hint={reasoning} endIcon={<Icons.disclosure />} onSelect={() => show('reasoning')}>
                Reasoning
              </MenuItem>
            ) : null}
          </ModelPicker>
        )}
      </MenuViews>
    </Popover>
  )
}

function BackRow({ children, onBack }: { children: string; onBack: () => void }) {
  return (
    <button
      type="button"
      autoFocus
      onClick={onBack}
      className="studio-control-flat flex w-full items-center gap-2 rounded-md px-2 text-left text-ui text-muted-foreground hover:bg-tint hover:text-foreground"
    >
      <Icons.back />
      {children}
    </button>
  )
}

function ContextPanel({
  model, breakdown, following, running, compacting, readiness, error, onCompact, onBack,
}: {
  model: CatalogModel | undefined
  breakdown: ContextBreakdown | null
  following: boolean
  running: boolean
  compacting: boolean
  readiness: CompactionReadiness | null
  error: string | null
  onCompact: () => void
  onBack: () => void
}) {
  const [detailed, setDetailed] = useState(false)
  const [highlight, setHighlight] = useState<ContextBandId | null>(null)

  return (
    <>
      <BackRow onBack={onBack}>Context window</BackRow>
      <MenuSeparator />
      <div className="flex flex-col gap-2.5 px-2 py-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {model === undefined ? null : <ProviderMark provider={model.author} bare />}
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-ui text-foreground">{model?.name ?? 'No model chosen'}</span>
            <span className="text-micro text-muted-foreground">
              {model === undefined
                ? `Model window unavailable. The meter uses a ${formatTokens(breakdown?.window ?? 0)}-token estimate.`
                : model.contextWindow === 'unknown'
                  ? 'Context window not declared'
                  : `${formatTokens(model.contextWindow)} context window`}
            </span>
          </span>
        </div>
        {following && model !== undefined ? (
          <p className="text-micro text-muted-foreground">Following the Chat default in Settings.</p>
        ) : null}
        {breakdown === null ? null : (
          <>
            {breakdown.windowDeclared && breakdown.total > breakdown.window ? (
              <p className="text-micro text-foreground">
                This conversation is larger than this model's window. It will be compacted on the next message.
              </p>
            ) : null}
            <ContextTank breakdown={breakdown} running={running} highlight={highlight} />
            <ContextCategories />
            <button
              type="button"
              onClick={() => { setHighlight(null); setDetailed(!detailed) }}
              aria-expanded={detailed}
              className="flex items-center gap-1 self-start text-caption text-muted-foreground hover:text-foreground"
            >
              <Icons.disclosure state={detailed ? 'on' : 'rest'} />
              {detailed ? 'Hide breakdown' : 'Breakdown'}
            </button>
            <MenuViews view={detailed ? 'breakdown' : 'summary'} depth={0} resize={false}>
              {detailed ? (
                <div role="group" aria-label="Context breakdown">
                  <ContextDetails breakdown={breakdown} onHighlight={setHighlight} />
                </div>
              ) : null}
            </MenuViews>
          </>
        )}
      </div>
      {readiness === null ? null : (
        <>
          <MenuSeparator />
          <MenuItem
            icon={<Icons.compaction />}
            disabled={compacting || running || !readiness.available}
            onSelect={onCompact}
          >
            {compacting ? 'Compacting...' : 'Compact now'}
          </MenuItem>
          {compacting || (!running && readiness.available) ? null : (
            <p className="px-2 pb-1 pl-8 text-micro text-muted-foreground">
              {running ? 'Finish or stop the run first.' : !readiness.available ? readiness.reason : null}
            </p>
          )}
        </>
      )}
      {error === null ? null : <p role="alert" className="px-2 pb-1 text-micro text-danger">{error}</p>}
    </>
  )
}

function restingFor(model: CatalogModel | undefined): ReasoningChoice | null {
  return model === undefined || model.reasoningLevels.length === 0
    ? null : restingReasoningLevel(model.reasoningLevels)
}

function reasoningName(level: ReasoningChoice): string {
  return REASONING_LEVEL_NOTES.find(({ id }) => id === level)?.name ?? capital(level)
}

function ReasoningPanel({
  model, choice, onBack, onChange,
}: {
  model: CatalogModel | undefined
  choice: ReasoningChoice | null
  onBack: () => void
  onChange: (choice: ReasoningChoice) => void
}) {
  const steps = (model?.reasoningLevels ?? []).map((level) => {
    const note = REASONING_LEVEL_NOTES.find((entry) => entry.id === level)
    return { id: level, name: note?.name ?? capital(level), note: note?.note }
  })
  return (
    <>
      <BackRow onBack={onBack}>Reasoning</BackRow>
      <MenuSeparator />
      <StepSlider
        steps={steps}
        value={choice !== null && steps.some((step) => step.id === choice) ? choice : restingFor(model) ?? 'medium'}
        onChange={onChange}
      />
    </>
  )
}
