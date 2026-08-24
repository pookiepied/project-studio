import { Icons } from '@/components/icons'
import { MenuItem, MenuLabel, Popover } from '@/components/primitives'
import { PERMISSION_MODES, findPermissionMode } from '@/domain/permissions/modes'
import { useWorkspace } from '@/stores/workspace'
import { Pane, Row } from '@/features/settings/panes/Pane'
import { useState } from 'react'

/**
 * General.
 *
 * The default execution mode lives here, and it is the same list the composer's
 * control shows — both read `PERMISSION_MODES`, so there is one description of
 * each mode in the app and the settings copy can never drift from the picker
 * copy.
 */
export function GeneralPane() {
  const { settings, setSettings } = useWorkspace()
  const [open, setOpen] = useState(false)
  const mode = findPermissionMode(settings.permission)
  const Glyph = mode.icon

  return (
    <Pane title="General" description="Defaults for new conversations.">
      <Row label="Execution mode" hint={mode.detail}>
        <Popover
          open={open}
          onOpenChange={setOpen}
          side="bottom"
          align="end"
          className="min-w-64"
          trigger={
            <button
              type="button"
              onClick={() => setOpen((value) => !value)}
              aria-haspopup="menu"
              aria-expanded={open}
              className="inline-flex h-7 items-center gap-1.5 rounded-md border bg-surface px-2.5 text-ui text-foreground transition-colors duration-fast hover:bg-tint"
            >
              <Glyph />
              {mode.name}
              <Icons.expand className="text-muted-foreground" />
            </button>
          }
        >
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
      </Row>

      <Row
        label="Undo history"
        hint="Every change the agent makes is snapshotted before it happens."
      />
      <Row label="Studio version" hint="0.1.0" />
    </Pane>
  )
}
