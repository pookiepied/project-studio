import { useState } from 'react'
import { Icons, ProviderMark } from '@/components/icons'
import { MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from '@/components/primitives'
import { findModel, modelsByProvider } from '@/domain/models/catalog'
import { EFFORTS } from '@/domain/models/types'
import { PERMISSION_MODES, findPermissionMode } from '@/domain/permissions/modes'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * The turn settings, gathered behind one mark.
 *
 * Model, effort and permission are one question -- "this turn" -- asked three
 * ways, so they share one menu rather than three controls. As pills in the
 * strip they took the width the identity line now has: the conversation's
 * project, title and branch are what the strip is for, and the settings only
 * matter when you go looking for them.
 *
 * ---- Why the trigger is labelled -----------------------------------------
 *
 * It shows the model it will use and the mode it will use it in, because both
 * are answers to "what happens when I press send" -- and that question is asked
 * before sending, not after. A bare mark hid them behind a click, so the two
 * facts that change what the app is about to do to someone's machine were the
 * two facts not on screen.
 *
 * The mode is a mark rather than a word. Three modes reuse three glyphs, so it
 * becomes recognisable in a way a fourth piece of text beside the model name
 * does not, and the name stays the thing being read.
 */
export function TurnMenu() {
  const { settings, setSettings } = useWorkspace()
  const [open, setOpen] = useState(false)

  const model = findModel(settings.modelId)
  const mode = findPermissionMode(settings.permission)
  const ModeMark = mode.icon

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="max-h-[26rem] min-w-64 overflow-y-auto"
      trigger={
        <Tooltip label={`${model?.name ?? 'Model'} · ${mode.name}`} side="bottom">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-label="Turn settings"
            className={cn(
              'flex max-w-56 items-center gap-1.5 rounded-md px-1.5 py-1 text-ui',
              'text-muted-foreground transition-colors duration-fast',
              open ? 'bg-selected text-foreground' : 'hover:bg-tint',
            )}
          >
            {/* Provider, then name, then mode -- who, what, and how far it may
                go. Reading order matches the sentence the control is answering.

                Both marks are stand-ins, not the vendors' logos: real assets
                arrive with their own colours and weights, so a row built from
                them is a row of mismatched brand assets in a monochrome app --
                and redistributing a trademark is a permission question nobody
                wants to discover late. See `ProviderMark`. */}
            {model ? <ProviderMark provider={model.providerId} className="shrink-0" /> : null}
            <span className="min-w-0 truncate">{model?.name ?? 'Model'}</span>
            <ModeMark className="shrink-0 opacity-70" />
            <Icons.disclosure state={open ? 'on' : 'rest'} className="shrink-0 opacity-60" />
          </button>
        </Tooltip>
      }
    >
      {modelsByProvider().map(({ provider, models }) => (
        <div key={provider.id}>
          {/* The provider's mark sits with its name, once, rather than on
              every model beneath it. Repeating a logo down a group says the
              rows differ by provider when what differs is the model -- and the
              check mark is the only thing in that column that should move. */}
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

      <MenuSeparator />
      <MenuLabel>Thinking</MenuLabel>
      {EFFORTS.map((effort) => (
        <MenuItem
          key={effort.id}
          selected={effort.id === settings.effort}
          onSelect={() => {
            setSettings({ ...settings, effort: effort.id })
            setOpen(false)
          }}
        >
          {effort.name}
        </MenuItem>
      ))}

      <MenuSeparator />
      <MenuLabel>What Studio may do</MenuLabel>
      {PERMISSION_MODES.map((candidate) => (
        <MenuItem
          key={candidate.id}
          selected={candidate.id === settings.permission}
          note={candidate.note}
          onSelect={() => {
            setSettings({ ...settings, permission: candidate.id })
            setOpen(false)
          }}
        >
          {candidate.name}
        </MenuItem>
      ))}
    </Popover>
  )
}
