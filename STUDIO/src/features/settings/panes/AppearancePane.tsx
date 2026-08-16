import { Icons } from '@/components/icons'
import { Button, Segmented } from '@/components/primitives'
import { useAppearance } from '@/design/theme'
import { CODE_SIZE_CHOICES, UI_SIZE_CHOICES } from '@/design/tokens'
import { resetWindowSize } from '@/platform/tauri'
import { Row, Pane } from '@/features/settings/panes/Pane'
import type { CodeSize, UiSize } from '@/design/tokens'

/**
 * Appearance.
 *
 * Text size is offered as three steps rather than a number field, and the two
 * sizes move the whole scale rather than one element. That is what keeps the
 * icon pairing intact: every step in the scale is a delta on this value, so an
 * icon beside 12px text is still the icon that was chosen to sit beside 12px
 * text. A free-form px input would let someone set UI text below its paired
 * icon and break the one rule the type system has.
 *
 * There is no reduced-motion switch. The OS already has one and the app already
 * obeys it, and a second control that can disagree with the first is a bug with
 * a settings row.
 */
export function AppearancePane() {
  const { appearance, update } = useAppearance()

  return (
    <Pane
      title="Appearance"
      description="How Studio looks on this machine."
    >
      <Row label="Theme">
        <Segmented
          layoutId="settings-theme"
          ariaLabel="Theme"
          value={appearance.theme}
          onChange={(theme) => update({ theme })}
          options={[
            { id: 'system', label: <><Icons.themeSystem />System</> },
            { id: 'light', label: <><Icons.themeLight />Light</> },
            { id: 'dark', label: <><Icons.themeDark />Dark</> },
          ]}
        />
      </Row>

      <Row label="Interface text" hint="Menus, the sidebar, and the composer.">
        <Segmented
          layoutId="settings-ui-size"
          ariaLabel="Interface text size"
          value={appearance.uiSize}
          onChange={(uiSize: UiSize) => update({ uiSize })}
          options={UI_SIZE_CHOICES.map((size) => ({ id: size, label: `${size}px` }))}
        />
      </Row>

      <Row label="Code text" hint="Code blocks and inline code.">
        <Segmented
          layoutId="settings-code-size"
          ariaLabel="Code text size"
          value={appearance.codeSize}
          onChange={(codeSize: CodeSize) => update({ codeSize })}
          options={CODE_SIZE_CHOICES.map((size) => ({ id: size, label: `${size}px` }))}
        />
      </Row>

      <Row
        label="Pointer cursor"
        hint="Use the hand cursor over controls, the way a browser does."
      >
        <Segmented
          layoutId="settings-cursor"
          ariaLabel="Pointer cursor"
          value={appearance.pointerCursor ? 'on' : 'off'}
          onChange={(value) => update({ pointerCursor: value === 'on' })}
          options={[
            { id: 'off', label: 'Off' },
            { id: 'on', label: 'On' },
          ]}
        />
      </Row>

      <Row
        label="Window"
        hint="Studio remembers the size and position you leave it at."
      >
        <Button variant="outline" onClick={() => void resetWindowSize()}>
          Reset to default size
        </Button>
      </Row>
    </Pane>
  )
}
