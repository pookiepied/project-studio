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
import { findModel, modelsByProvider } from '@/domain/models/catalog'
import { EFFORTS } from '@/domain/models/types'
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
 * ---- Why reasoning is a slider ---------------------------------------------
 *
 * Because it is the one setting here that is a dial rather than a choice. The
 * steps are ordered and adjacent ones are near-equivalent: nobody wants "high"
 * specifically, they want "more than medium". A column of rows says these are
 * five unrelated options and hides the ordering that is the entire meaning.
 *
 * It also absorbs the thing that will otherwise break this screen later —
 * models disagree about their scales. Four steps, six steps, a differently
 * named top end. A track is the same control at any length; a list of rows
 * changes height and position every time the model changes, moving the setting
 * out from under the pointer that was adjusting it.
 */
export function TurnMenu() {
  const { settings, setSettings } = useWorkspace()
  const { openSettings } = useNavigation()
  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'root' | 'reasoning'>('root')

  const model = findModel(settings.modelId)
  const effort = EFFORTS.find((candidate) => candidate.id === settings.effort)

  // Reopening lands on the top level. A menu that remembers it was left on a
  // sub-page reopens showing something other than what its trigger describes.
  useEffect(() => {
    if (!open) setView('root')
  }, [open])

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="studio-scroll-bounded max-h-[28rem] w-72 overflow-y-auto"
      trigger={
        <Tooltip
          label={[model?.name ?? 'Model', effort?.name].filter(Boolean).join(' · ')}
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
            {/* Provider and name: who and what. Not how far it may go --
                that is the composer's permission control, sitting inside the
                field where the sentence it governs is being written. Stated
                twice, the two marks were a question ("do these mean the same
                thing?") rather than an answer, and this copy was the one with
                no way to change it. One fact, one place. */}
            {model ? <ProviderMark provider={model.providerId} className="shrink-0" /> : null}
            <span className="min-w-0 truncate">{model?.name ?? 'Model'}</span>
            <Icons.disclosure state={open ? 'on' : 'rest'} className="shrink-0 opacity-60" />
          </button>
        </Tooltip>
      }
    >
      {view === 'reasoning' ? (
        <>
          <button
            type="button"
            onClick={() => setView('root')}
            className="flex w-full items-center gap-1.5 rounded-sm px-2 py-1.5 text-ui text-muted-foreground hover:bg-tint"
          >
            {/* Pointing back the way it came. The same mark the disclosures
                use, turned — one idea of "there is more this way". */}
            <Icons.disclosure className="shrink-0 rotate-180" />
            Reasoning
          </button>
          <MenuSeparator />
          <StepSlider
            steps={EFFORTS}
            value={settings.effort}
            onChange={(next) => setSettings({ ...settings, effort: next })}
          />
        </>
      ) : (
        <>
          {modelsByProvider().map(({ provider, models }) => (
            <div key={provider.id}>
              {/* The provider's mark sits with its name, once, rather than on
                  every model beneath it. Repeating a logo down a group says the
                  rows differ by provider when what differs is the model. */}
              <MenuLabel>
                <span className="flex items-center gap-1.5">
                  <ProviderMark provider={provider.id} />
                  {provider.name}
                </span>
              </MenuLabel>
              {models.map((candidate) => (
                <MenuItem
                  key={candidate.id}
                  selected={candidate.id === settings.modelId}
                  note={candidate.note}
                  onSelect={() => {
                    setSettings({ ...settings, modelId: candidate.id })
                    setOpen(false)
                  }}
                >
                  {candidate.name}
                </MenuItem>
              ))}
            </div>
          ))}

          {/* Where a user's own models arrive from, rather than letting them
              swell this list. A picker is for choosing; adding is a different
              activity and needs a page that can hold a key, a base URL and a
              wire format without becoming a menu. */}
          <MenuItem icon={<Icons.mcp />} onSelect={() => { setOpen(false); openSettings('providers') }}>
            Model library…
          </MenuItem>

          <MenuSeparator />

          {/* Not a submenu that opens sideways: at this width a flyout would
              leave the window. It replaces the panel's contents, the way a
              settings pane does, and the header row is the way back. */}
          <MenuItem
            icon={<Icons.reasoning />}
            hint={effort?.name}
            onSelect={() => setView('reasoning')}
          >
            Reasoning
          </MenuItem>

        </>
      )}
    </Popover>
  )
}
