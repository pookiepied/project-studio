import { useMemo, useState, type ReactNode } from 'react'
import { Icons, ProviderMark } from '@/components/icons'
import { MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from '@/components/primitives'
import { findModel, modelsByProvider } from '@/domain/models/catalog'
import { EFFORTS } from '@/domain/models/types'
import { PERMISSION_MODES, findPermissionMode } from '@/domain/permissions/modes'
import { useNavigation } from '@/stores/navigation'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * The turn settings: one pill, three targets.
 *
 * ---- Why it split ----------------------------------------------------------
 *
 * This was a single button opening a single menu that stacked models, then
 * reasoning, then permission, in one scrolling column. That construction has a
 * ceiling and we were already at it: the moment a user brings their own keys
 * the model list is twenty rows, the two settings underneath fall off the
 * bottom, and every one of them is reached by scrolling past models the user
 * was not choosing between.
 *
 * The deeper problem is that they were never one question. Who you are talking
 * to, how hard it should think, and what it may touch without asking are three
 * different kinds of decision -- one is an identity, one is a dial, one is a
 * consent. Stacking them in a column says they are the same kind of thing and
 * makes the most consequential of the three the hardest to reach.
 *
 * So: still one pill, because on screen these are one idea -- "what happens
 * when I press send". Inside it, three segments that each open their own small
 * menu. Nothing scrolls until the model list itself is long, and the permission
 * mode is one click from anywhere instead of one click plus a scroll.
 *
 * ---- Why the segments are ordered this way --------------------------------
 *
 * Model, reasoning, permission -- widest to narrowest, and least to most
 * consequential. The model name is the thing being read, so it leads; the
 * permission mode is the thing that changes what happens to your machine, so it
 * sits at the end where the eye lands last and the pointer travels least from
 * the composer.
 */
export function TurnMenu() {
  const { settings, setSettings } = useWorkspace()
  const { openSettings } = useNavigation()
  const [open, setOpen] = useState<'model' | 'effort' | 'permission' | null>(null)

  const model = findModel(settings.modelId)
  const mode = findPermissionMode(settings.permission)
  const effort = useMemo(
    () => EFFORTS.find((candidate) => candidate.id === settings.effort),
    [settings.effort],
  )
  const ModeMark = mode.icon

  const close = () => setOpen(null)

  return (
    <div
      className={cn(
        // One container, so the three read as a single control rather than as
        // three loose buttons that happen to be adjacent. The dividers are the
        // only thing saying they are separable, and they are 1px of hairline --
        // enough to find, not enough to look like a toolbar.
        'flex items-center rounded-md border border-hairline bg-surface-raised',
        'divide-x divide-hairline',
      )}
    >
      <Segment
        open={open === 'model'}
        onOpenChange={(next) => setOpen(next ? 'model' : null)}
        tooltip="Model"
        label={model?.name ?? 'Model'}
        leading={model ? <ProviderMark provider={model.providerId} className="shrink-0" /> : null}
        className="max-w-44 rounded-l-md"
      >
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
                  close()
                }}
              >
                {candidate.name}
              </MenuItem>
            ))}
          </div>
        ))}

        {/* Where a user's own models arrive from, rather than letting them
            swell this list. A picker is for choosing; adding is a different
            activity and belongs on a page that can hold a key, a base URL and
            a wire format without becoming a menu. */}
        <MenuSeparator />
        <MenuItem
          icon={<Icons.settings />}
          onSelect={() => {
            close()
            openSettings('providers')
          }}
        >
          Manage models…
        </MenuItem>
      </Segment>

      <Segment
        open={open === 'effort'}
        onOpenChange={(next) => setOpen(next ? 'effort' : null)}
        tooltip="Reasoning"
        label={effort?.name ?? 'Reasoning'}
        leading={<Icons.reasoning className="shrink-0" />}
      >
        <MenuLabel>Reasoning</MenuLabel>
        {EFFORTS.map((candidate) => (
          <MenuItem
            key={candidate.id}
            selected={candidate.id === settings.effort}
            note={candidate.note}
            onSelect={() => {
              setSettings({ ...settings, effort: candidate.id })
              close()
            }}
          >
            {candidate.name}
          </MenuItem>
        ))}
      </Segment>

      {/* The mode is a mark alone, no word.
          Three modes reuse three glyphs, so the mark becomes recognisable in a
          way a third piece of text in the pill would not -- and the pill has a
          width budget the model name should be spending. The name is one hover
          away and the whole thing is a click away. */}
      <Segment
        open={open === 'permission'}
        onOpenChange={(next) => setOpen(next ? 'permission' : null)}
        tooltip={`What Studio may do · ${mode.name}`}
        leading={<ModeMark className="shrink-0" />}
        align="end"
        className="rounded-r-md"
      >
        <MenuLabel>What Studio may do</MenuLabel>
        {PERMISSION_MODES.map((candidate) => (
          <MenuItem
            key={candidate.id}
            selected={candidate.id === settings.permission}
            note={candidate.note}
            onSelect={() => {
              setSettings({ ...settings, permission: candidate.id })
              close()
            }}
          >
            {candidate.name}
          </MenuItem>
        ))}
      </Segment>
    </div>
  )
}

/**
 * One segment of the pill.
 *
 * The disclosure chevron appears on the segment that is open and on hover, not
 * permanently on all three: three chevrons in a control this size is three
 * arrows competing with the one word that matters.
 */
function Segment({
  open,
  onOpenChange,
  tooltip,
  label,
  leading,
  align = 'start',
  className,
  children,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  tooltip: string
  label?: string
  leading?: ReactNode
  align?: 'start' | 'end'
  className?: string
  children: ReactNode
}) {
  return (
    <Popover
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      align={align}
      className="max-h-[26rem] min-w-56 overflow-y-auto"
      trigger={
        <Tooltip label={tooltip} side="bottom">
          <button
            type="button"
            onClick={() => onOpenChange(!open)}
            aria-label={tooltip}
            className={cn(
              'group flex items-center gap-1.5 px-2 py-1 text-ui',
              'text-muted-foreground transition-colors duration-fast',
              open ? 'bg-selected text-foreground' : 'hover:bg-tint',
              className,
            )}
          >
            {leading}
            {label ? <span className="min-w-0 truncate">{label}</span> : null}
            <Icons.disclosure
              state={open ? 'on' : 'rest'}
              className={cn(
                'shrink-0 transition-opacity duration-fast',
                open ? 'opacity-60' : 'opacity-0 group-hover:opacity-60',
              )}
            />
          </button>
        </Tooltip>
      }
    >
      {children}
    </Popover>
  )
}
