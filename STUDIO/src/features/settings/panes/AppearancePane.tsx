import { Icons } from '@/components/icons'
import { Button, Segmented } from '@/components/primitives'
import { useAppearance } from '@/design/theme'
import { CODE_OFFSET_CHOICES, UI_SIZE_CHOICES, codeSizeFor } from '@/design/tokens'
import { resetWindowSize } from '@/platform/tauri'
import { Row, Pane } from '@/features/settings/panes/Pane'
import type { CodeOffset, UiSize } from '@/design/tokens'

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
  const { appearance, update, isDefault, reset } = useAppearance()

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

      {/* The choice stored is an offset from the interface text, but the label
          shows what that offset actually resolves to, so the row reads as a
          size and re-labels itself the moment the interface size above it
          changes. Storing the relationship and displaying the number is what
          keeps "one step under" true at every setting instead of only at the
          default — see `CODE_OFFSET_CHOICES`. */}
      <Row label="Code text" hint="Code blocks and inline code, kept a step under the interface.">
        <Segmented
          layoutId="settings-code-size"
          ariaLabel="Code text size"
          value={appearance.codeOffset}
          onChange={(codeOffset: CodeOffset) => update({ codeOffset })}
          options={CODE_OFFSET_CHOICES.map((offset) => ({
            id: offset,
            label: `${codeSizeFor(appearance.uiSize, offset)}px`,
          }))}
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
        <Button variant="secondary" size="sm" onClick={() => void resetWindowSize()}>
          Reset to default size
        </Button>
      </Row>

      {/* Says which of the two states you are in, and gets you out of one of
          them. Worth a row of its own because the alternative was unknowable:
          preferences persist, a stored value always outranks the default, and
          nothing on this screen distinguished "this is what Studio ships with"
          from "this is something you picked once months ago". A size chosen
          during one experiment sat there for weeks doing exactly that. */}
      <Row
        label="Defaults"
        hint={
          isDefault
            ? 'Everything here is what Studio ships with.'
            : 'Some of these differ from what Studio ships with.'
        }
      >
        <Button variant="secondary" size="sm" disabled={isDefault} onClick={reset}>
          {isDefault ? 'Using defaults' : 'Reset to defaults'}
        </Button>
      </Row>
    </Pane>
  )
}
