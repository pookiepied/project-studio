import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button, Stepper, Switch } from '@/components/primitives'
import { useAppearance, type Theme } from '@/design/theme'
import {
  CODE_OFFSET_CHOICES,
  TYPEFACE_CHOICES,
  UI_SCALE_CHOICES,
  UI_SIZE_CHOICES,
  codeSizeFor,
  type CodeOffset,
  type Typeface,
  type UiScale,
} from '@/design/tokens'
import { applyWindowSize, onWindowResized, readWindowSize, type WindowSize } from '@/platform/tauri'
import { Pane, PaneSection, Row } from '@/features/settings/panes/Pane'
import { useNavigation } from '@/stores/navigation'
import { cn } from '@/lib/cn'

/**
 * Appearance, in the order a person decides it: what it looks like, what it
 * reads like, how big it is, then the rest.
 *
 * Size is two settings on purpose. Text size moves type and the controls paired
 * with it, and stays a small step scale so an icon beside text is still the icon
 * chosen for that text. UI scale multiplies the whole window, spacing and
 * dimensions included: see `setInterfaceZoom`.
 *
 * There is no reduced-motion switch. The OS already has one and the app already
 * obeys it, and a second control that can disagree with the first is a bug with
 * a settings row.
 */

const THEMES: readonly { readonly id: Theme; readonly label: string }[] = [
  { id: 'light', label: 'Light' },
  { id: 'dark', label: 'Dark' },
  { id: 'system', label: 'System' },
]

const WINDOW_SIZE_CHOICES: readonly { readonly id: WindowSize; readonly label: string; readonly sidebarOpen: boolean }[] = [
  { id: 'compact', label: 'Compact', sidebarOpen: false },
  { id: 'standard', label: 'Standard', sidebarOpen: true },
]

const TYPEFACE_LABELS: Readonly<Record<Typeface, string>> = {
  sans: 'Sans serif',
  serif: 'Serif',
  mono: 'Mono',
}

export function AppearancePane() {
  const { appearance, update, isDefault, reset } = useAppearance()
  const { setSidebarOpen } = useNavigation()
  const windowSize = useWindowSize()
  const codeSize = (offset: CodeOffset) => codeSizeFor(appearance.uiSize, offset)

  return (
    <Pane title="Appearance" description="How Studio looks on this machine.">
      <PaneSection title="Interface theme">
        <div role="radiogroup" aria-label="Interface theme" className="studio-choice-grid">
          {THEMES.map((theme) => (
            <Choice
              key={theme.id}
              label={theme.label}
              selected={appearance.theme === theme.id}
              onSelect={() => update({ theme: theme.id })}
            >
              <ThemePreview theme={theme.id} />
            </Choice>
          ))}
        </div>
      </PaneSection>

      <PaneSection title="Typeface" hint="Used across Studio. Code keeps its monospaced face.">
        <div role="radiogroup" aria-label="Typeface" className="studio-choice-grid">
          {TYPEFACE_CHOICES.map((typeface) => (
            <Choice
              key={typeface}
              label={TYPEFACE_LABELS[typeface]}
              selected={appearance.typeface === typeface}
              onSelect={() => update({ typeface })}
            >
              <span className="studio-choice-type" data-typeface={typeface}>Aa Bb Cc</span>
            </Choice>
          ))}
        </div>
      </PaneSection>

      <PaneSection title="Size">
        <Row label="Text size" hint="Replies and drafts use this size. Interface labels stay one step smaller, at least 12px.">
          <Stepper
            label="Text size"
            value={appearance.uiSize}
            choices={UI_SIZE_CHOICES}
            onChange={(uiSize) => update({ uiSize })}
          />
        </Row>

        {/* The stored choice is an offset from the text size, so "one step
            under" stays true at every size; the counter shows what it resolves
            to, and re-labels itself when the text size above it moves. */}
        <Row label="Code text" hint="Code blocks, diffs and inline code.">
          <Stepper
            label="Code text size"
            value={appearance.codeOffset}
            choices={CODE_OFFSET_CHOICES}
            onChange={(codeOffset) => update({ codeOffset })}
            format={codeSize}
          />
        </Row>

        <Row label="UI scale" hint="Everything in the window: text, icons, spacing and panels.">
          <UiScaleStepper />
        </Row>
      </PaneSection>

      <PaneSection title="Window size" hint="Compact is the default. Studio remembers any size you leave it at.">
        <div role="radiogroup" aria-label="Window size" className="studio-choice-grid">
          {WINDOW_SIZE_CHOICES.map((size) => (
            <Choice
              key={size.id}
              label={size.label}
              selected={windowSize === size.id}
              onSelect={() => void applyWindowSize(size.id).then(() => setSidebarOpen(size.sidebarOpen))}
            >
              <WindowPreview size={size.id} sidebar={size.sidebarOpen} />
            </Choice>
          ))}
        </div>
      </PaneSection>

      <PaneSection title="Window and controls">
        <Row label="Pointer cursor" hint="Use the hand cursor over controls, the way a browser does.">
          <Switch
            label="Pointer cursor"
            checked={appearance.pointerCursor}
            onChange={(value) => update({ pointerCursor: value })}
          />
        </Row>

        {/* Says which of the two states you are in, and gets you out of one of
            them: a stored value always outranks the default, and nothing else
            here distinguishes "what Studio ships with" from "something you
            picked once months ago". */}
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
      </PaneSection>
    </Pane>
  )
}

/**
 * Read from the window rather than stored: a person can drag it to any size, and
 * then neither choice is true. A stored choice would keep claiming one.
 */
function useWindowSize(): WindowSize | null {
  const [size, setSize] = useState<WindowSize | null>(null)

  useEffect(() => {
    let live = true
    let stop = () => {}
    const refresh = () => void readWindowSize().then((next) => { if (live) setSize(next) })

    refresh()
    void onWindowResized(refresh).then((unlisten) => {
      if (live) stop = unlisten
      else unlisten()
    })
    return () => {
      live = false
      stop()
    }
  }, [])

  return size
}

/** Long enough to reach for the next click, short enough to read as a response. */
const UI_SCALE_SETTLE_MS = 600

/**
 * The one counter that moves itself: a new scale re-lays the whole page, which
 * carries these buttons out from under the pointer, so a second click at the
 * same spot lands on nothing or on a different control. The number answers at
 * once and the window rescales when the clicking stops.
 *
 * The timer is deliberately not cleared on unmount: leaving the pane straight
 * after a click still has to apply it, and `update` belongs to the provider.
 */
function UiScaleStepper() {
  const { appearance, update } = useAppearance()
  const [pending, setPending] = useState<UiScale | null>(null)
  const settling = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const choose = (uiScale: UiScale) => {
    setPending(uiScale)
    clearTimeout(settling.current)
    settling.current = setTimeout(() => {
      update({ uiScale })
      setPending(null)
    }, UI_SCALE_SETTLE_MS)
  }

  return (
    <Stepper
      label="UI scale"
      value={pending ?? appearance.uiScale}
      choices={UI_SCALE_CHOICES}
      onChange={choose}
      format={(scale) => `${scale}%`}
    />
  )
}

function Choice({
  label,
  selected,
  onSelect,
  children,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  children: ReactNode
}) {
  return (
    <button type="button" role="radio" aria-checked={selected} aria-label={label} onClick={onSelect} className="studio-choice">
      <span className={cn('studio-choice-card', selected && 'studio-choice-card-selected')}>
        {children}
        <span aria-hidden className="studio-choice-dot" />
      </span>
      <span className="text-ui text-foreground">{label}</span>
    </button>
  )
}

/** The window at this size, with the sidebar it has room for. */
function WindowPreview({ size, sidebar }: { size: WindowSize; sidebar: boolean }) {
  return (
    <span className="studio-window-preview" data-size={size}>
      {sidebar ? <span className="studio-window-preview-side" /> : null}
      <span className="studio-window-preview-body">
        <span className="studio-window-preview-composer" />
      </span>
    </span>
  )
}

/** A small drawing of the window. Its colours are the theme's, not the current one's. */
function ThemePreview({ theme }: { theme: Theme }) {
  if (theme === 'system') {
    return (
      <span className="studio-theme-preview-split">
        <ThemePreview theme="light" />
        <ThemePreview theme="dark" />
      </span>
    )
  }
  return (
    <span className="studio-theme-preview" data-preview={theme}>
      <span className="studio-theme-preview-bubble" />
      <span className="studio-theme-preview-line" />
      <span className="studio-theme-preview-line studio-theme-preview-line-short" />
      <span className="studio-theme-preview-composer">
        <span className="studio-theme-preview-send" />
      </span>
    </span>
  )
}
