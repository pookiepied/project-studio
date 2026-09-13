import { Icons } from '@/components/icons'
import { MenuItem, MenuLabel, Popover, Segmented } from '@/components/primitives'
import { PERMISSION_MODE_ICONS } from '@/features/chat/permissions/modeIcon'
import { PERMISSION_MODES, findPermissionMode } from '@/domain/permissions/modes'
import { useWorkspace } from '@/stores/workspace'
import { isTauri } from '@/platform/tauri'
import { Pane, Row } from '@/features/settings/panes/Pane'
import {
  DEFAULT_WINDOW_PREFERENCES,
  loadLaunchAtStartup,
  loadWindowPreferences,
  saveWindowPreferences,
  setLaunchAtStartup as setLaunchAtStartupPreference,
  type WindowPreferences,
} from '@/platform/window-preferences'
import { useEffect, useState } from 'react'

/**
 * General.
 *
 * The default execution mode lives here, and it is the same list the composer's
 * control shows — both read `PERMISSION_MODES`, so there is one description of
 * each mode in the app and the settings copy can never drift from the picker
 * copy.
 *
 * Two rows are about being a desktop app — the tray and the login item — and
 * a browser tab is not the app's life (plan step 6): they do not render off
 * the desktop, rather than rendering as controls that change nothing.
 */
export function GeneralPane() {
  const { settings, setSettings } = useWorkspace()
  const [open, setOpen] = useState(false)
  const mode = findPermissionMode(settings.permission)
  const Glyph = PERMISSION_MODE_ICONS[mode.id]
  const onDesktop = isTauri()

  // Both desktop settings are read once when the pane opens rather than held
  // in app-wide state. Nothing else in the app renders them, and the login
  // item in particular has to be re-read from the operating system anyway --
  // a cached copy could disagree with the registry.
  const [windowPreferences, setWindowPreferences] = useState(
    DEFAULT_WINDOW_PREFERENCES,
  )
  const [launchAtStartup, setLaunchAtStartup] = useState(false)

  useEffect(() => {
    let live = true
    void loadWindowPreferences().then((stored) => {
      if (live) setWindowPreferences(stored)
    })
    void loadLaunchAtStartup().then((enabled) => {
      if (live) setLaunchAtStartup(enabled)
    })
    return () => {
      live = false
    }
  }, [])

  const updateWindow = async (change: Partial<WindowPreferences>) => {
    const next = { ...windowPreferences, ...change }
    setWindowPreferences(next)
    await saveWindowPreferences(next)
  }

  // Set from what the operating system reports afterwards, not from what was
  // asked for. A registry the app is not allowed to write must not leave a
  // toggle showing a change that did not happen.
  const updateStartup = async (enabled: boolean) => {
    setLaunchAtStartup(await setLaunchAtStartupPreference(enabled))
  }

  return (
    <Pane
      title="General"
      description="Defaults for new conversations, and how Studio behaves as a desktop app."
    >
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
              <Icons.dropdown />
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

      {onDesktop && (
        <Row
          label="Keep running when the window closes"
          hint={
            windowPreferences.closeToTray
              ? 'Turns in progress carry on, and the tray icon brings the window back. Quit Studio from the tray menu.'
              : 'Closing the window quits Studio, stopping any turn still running.'
          }
        >
          <Segmented
            layoutId="settings-close-to-tray"
            ariaLabel="Keep running when the window closes"
            value={windowPreferences.closeToTray ? 'on' : 'off'}
            onChange={(value) => void updateWindow({ closeToTray: value === 'on' })}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'on', label: 'On' },
            ]}
          />
        </Row>
      )}

      {onDesktop && (
        <Row
          label="Launch at startup"
          hint={
            launchAtStartup
              ? 'Studio starts with your computer and waits in the tray, without opening a window.'
              : 'Studio starts only when you open it.'
          }
        >
          <Segmented
            layoutId="settings-launch-at-startup"
            ariaLabel="Launch at startup"
            value={launchAtStartup ? 'on' : 'off'}
            onChange={(value) => void updateStartup(value === 'on')}
            options={[
              { id: 'off', label: 'Off' },
              { id: 'on', label: 'On' },
            ]}
          />
        </Row>
      )}

      <Row
        label="Undo history"
        hint="Every change the agent makes is snapshotted before it happens."
      />
      <Row label="Studio version" hint="0.1.0" />
    </Pane>
  )
}
