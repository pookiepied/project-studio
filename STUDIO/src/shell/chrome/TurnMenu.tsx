import { useState } from 'react'
import { Icons } from '@/components/icons'
import { IconButton, MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/primitives'
import { modelsByProvider } from '@/domain/models/catalog'
import { EFFORTS } from '@/domain/models/types'
import { PERMISSION_MODES } from '@/domain/permissions/modes'
import { useWorkspace } from '@/stores/workspace'

/**
 * The turn settings, gathered behind one mark.
 *
 * Model, effort and permission are one question -- "this turn" -- asked three
 * ways, so they share one menu rather than three controls. As pills in the
 * strip they took the width the identity line now has: the conversation's
 * project, title and branch are what the strip is for, and the settings only
 * matter when you go looking for them.
 *
 * The trigger carries no current value. A labelled control has to be read to be
 * dismissed; a mark has to be opened to be judged, and the settings here are
 * changed by decision rather than by glance.
 */
export function TurnMenu() {
  const { settings, setSettings } = useWorkspace()
  const [open, setOpen] = useState(false)

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="bottom"
      align="end"
      className="max-h-[26rem] min-w-64 overflow-y-auto"
      trigger={
        <IconButton
          label="Turn settings"
          tooltipSide="bottom"
          active={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icons.more />
        </IconButton>
      }
    >
      {modelsByProvider().map(({ provider, models }) => (
        <div key={provider.id}>
          <MenuLabel>{provider.name}</MenuLabel>
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
