import { useState, type ReactNode } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { AppearanceProvider, useAppearance, type Appearance, type Theme } from '@/design/theme'
import {
  COLLAPSE,
  DURATION,
  FADE,
  SPRING_PANEL,
  SPRING_SNAPPY,
  SPRING_SURFACE,
  UI_SIZE_CHOICES,
  surfaceVariants,
  type SurfaceMove,
} from '@/design/tokens'
import { Icons } from '@/components/icons'
import {
  Button,
  Dialog,
  IconButton,
  MenuLabel,
  MenuItem,
  MenuSeparator,
  Popover,
  Segmented,
  StepSlider,
  TextArea,
  TextField,
  Tooltip,
} from '@/components/primitives'
import { StateNote } from '@/components/state'

/**
 * The parts, on one page.
 *
 * Every component the app is built from, mounted live in the real tokens —
 * nothing here is a mock, a screenshot or a parallel implementation, so what
 * hovers, focuses, presses and springs is exactly what the product ships.
 * Walk it top to bottom when judging the design; whatever fails here fails
 * in the app, and whatever is fixed here is fixed everywhere the part is
 * used. Dev-only: see `main.tsx` for why the shipped app does not contain
 * this page.
 */
export function Showcase({ initialAppearance }: { initialAppearance: Appearance }) {
  return (
    <MotionConfig reducedMotion="user">
      <AppearanceProvider initial={initialAppearance}>
        <ShowcasePage />
      </AppearanceProvider>
    </MotionConfig>
  )
}

function ShowcasePage() {
  const { appearance, resolvedTheme, update } = useAppearance()

  return (
    <div className="h-full overflow-y-auto bg-surface text-foreground">
      <div className="mx-auto flex max-w-3xl flex-col gap-14 px-6 py-10">
        <header className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <h1 className="studio-display text-foreground">The parts</h1>
            <p className="text-caption text-muted-foreground">
              Every component in its real states, on the real tokens. Dev-only — served at
              /showcase.html, never built into the app.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <span className="text-micro text-muted-foreground">Theme</span>
              <Segmented<Theme>
                layoutId="showcase-theme"
                ariaLabel="Theme"
                value={appearance.theme}
                onChange={(theme) => update({ theme })}
                options={[
                  { id: 'system', label: 'System' },
                  { id: 'light', label: 'Light' },
                  { id: 'dark', label: 'Dark' },
                ]}
              />
              <span className="text-micro text-muted-foreground">now: {resolvedTheme}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-micro text-muted-foreground">Text</span>
              <Segmented
                layoutId="showcase-size"
                ariaLabel="Interface text size"
                value={appearance.uiSize}
                onChange={(uiSize) => update({ uiSize })}
                options={UI_SIZE_CHOICES.map((size) => ({ id: size, label: String(size) }))}
              />
            </div>
          </div>
        </header>

        <ButtonsSection />
        <IconButtonsSection />
        <FieldsSection />
        <ControlsSection />
        <OverlaysSection />
        <StatesSection />
        <ColourSection />
        <TypeSection />
        <ElevationSection />
        <MotionSection />

        <footer className="pb-4">
          <p className="text-micro text-muted-foreground">
            The states rule (design/RULES §1) is the thing to judge everywhere above: one
            channel per state, hover acknowledges, press deepens, and nothing moves to be
            charming.
          </p>
        </footer>
      </div>
    </div>
  )
}

function Section({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title text-foreground">{title}</h2>
        <p className="text-caption text-muted-foreground">{note}</p>
      </div>
      {children}
    </section>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-4">{children}</div>
}

/** One specimen per line, labelled on the left, the way a spec sheet reads. */
function Specimen({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center gap-4">
      <span className="w-24 shrink-0 text-micro text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-3">{children}</div>
    </div>
  )
}

const BUTTON_VARIANTS = ['primary', 'secondary', 'ghost', 'danger'] as const
const BUTTON_SIZES = ['xs', 'sm', 'md', 'lg'] as const

function ButtonsSection() {
  return (
    <Section
      title="Buttons"
      note="Three ranks and danger. The rank states what the page wants; one surface carries one primary."
    >
      <Card>
        {BUTTON_VARIANTS.map((variant) => (
          <Specimen key={variant} label={variant}>
            <Button variant={variant}>Do the thing</Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} busy>
              In flight
            </Button>
            <Button variant={variant} icon={<Icons.check size="sm" />}>
              With a mark
            </Button>
          </Specimen>
        ))}
        <Specimen label="sizes">
          {BUTTON_SIZES.map((size) => (
            <Button key={size} variant="secondary" size={size}>
              {size}
            </Button>
          ))}
        </Specimen>
        <Specimen label="full width">
          <div className="w-64">
            <Button variant="primary" fullWidth>
              Take the whole row
            </Button>
          </div>
        </Specimen>
      </Card>
    </Section>
  )
}

function IconButtonsSection() {
  return (
    <Section
      title="Icon buttons"
      note="Round, tooltip-labelled, hover published to the mark. Hover one — the glyph does not darken; the chip does the answering."
    >
      <Card>
        <Specimen label="sizes">
          {(['sm', 'md', 'lg'] as const).map((size) => (
            <IconButton key={size} label={`Search, ${size}`} size={size}>
              <Icons.search size={size} />
            </IconButton>
          ))}
        </Specimen>
        <Specimen label="states">
          <IconButton label="Settings">
            <Icons.settings size="md" />
          </IconButton>
          <IconButton label="Settings, active" active>
            <Icons.settings size="md" />
          </IconButton>
          <IconButton label="Settings, disabled" disabled>
            <Icons.settings size="md" />
          </IconButton>
        </Specimen>
      </Card>
    </Section>
  )
}

function FieldsSection() {
  const [filled, setFilled] = useState('Already said')
  const [secret, setSecret] = useState('harness-key-000')
  const [long, setLong] = useState('A longer answer that needs more than one line to say.')

  return (
    <Section
      title="Fields"
      note="Focus is the border, deepened — nothing blooms around it. Click into each and judge the edge."
    >
      <Card>
        <Specimen label="empty">
          <div className="w-64">
            <TextField value="" onChange={() => undefined} placeholder="Type a name" />
          </div>
        </Specimen>
        <Specimen label="filled">
          <div className="w-64">
            <TextField value={filled} onChange={setFilled} ariaLabel="Filled field" />
          </div>
        </Specimen>
        <Specimen label="secret">
          <div className="w-64">
            <TextField value={secret} onChange={setSecret} type="password" ariaLabel="Secret field" />
          </div>
        </Specimen>
        <Specimen label="area">
          <div className="w-64">
            <TextArea value={long} onChange={setLong} />
          </div>
        </Specimen>
      </Card>
    </Section>
  )
}

function ControlsSection() {
  const [view, setView] = useState<'form' | 'json'>('form')
  const [density, setDensity] = useState<'comfortable' | 'compact'>('comfortable')
  const [step, setStep] = useState<'quick' | 'steady' | 'deep'>('steady')

  return (
    <Section
      title="Segmented and stepped"
      note="The segmented thumb is one object sliding, not two backgrounds crossfading. The slider steps; it does not scroll."
    >
      <Card>
        <Specimen label="segmented">
          <Segmented<'form' | 'json'>
            layoutId="showcase-view"
            ariaLabel="Editor view"
            value={view}
            onChange={setView}
            options={[
              { id: 'form', label: 'Form' },
              { id: 'json', label: 'JSON' },
            ]}
          />
          <Segmented<'comfortable' | 'compact'>
            layoutId="showcase-density"
            ariaLabel="Density"
            value={density}
            onChange={setDensity}
            options={[
              { id: 'comfortable', label: 'Comfortable' },
              { id: 'compact', label: 'Compact' },
            ]}
          />
        </Specimen>
        <Specimen label="stepped">
          <div className="w-72">
            <StepSlider<'quick' | 'steady' | 'deep'>
              value={step}
              onChange={setStep}
              minLabel="Quicker"
              maxLabel="Deeper"
              steps={[
                { id: 'quick', name: 'Quick', note: 'Answers inside the sentence.' },
                { id: 'steady', name: 'Steady' },
                { id: 'deep', name: 'Deep', note: 'Thinks longer, reads further.' },
              ]}
            />
          </div>
        </Specimen>
      </Card>
    </Section>
  )
}

function OverlaysSection() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')

  return (
    <Section
      title="Overlays"
      note="Tooltip answers a hover, popover answers a click, dialog takes the page. All three enter and leave — close each and watch the exit."
    >
      <Card>
        <Specimen label="tooltip">
          <Tooltip label="Hovered hint, above">
            <Button variant="secondary">Hover, top</Button>
          </Tooltip>
          <Tooltip label="Hovered hint, beside" side="right">
            <Button variant="secondary">Hover, right</Button>
          </Tooltip>
        </Specimen>
        <Specimen label="popover">
          <Popover
            open={menuOpen}
            onOpenChange={setMenuOpen}
            trigger={
              <Button variant="secondary" onClick={() => setMenuOpen((open) => !open)}>
                Open a menu
              </Button>
            }
          >
            <MenuLabel>Conversation</MenuLabel>
            <MenuItem icon={<Icons.newChat size="sm" />} hint="⌘N" onSelect={() => setMenuOpen(false)}>
              New
            </MenuItem>
            <MenuItem
              icon={<Icons.search size="sm" />}
              note="A new conversation carrying everything said here."
              onSelect={() => setMenuOpen(false)}
            >
              Fork
            </MenuItem>
            <MenuSeparator />
            <MenuItem destructive onSelect={() => setMenuOpen(false)}>
              Delete
            </MenuItem>
          </Popover>
        </Specimen>
        <Specimen label="dialog">
          <Button variant="primary" onClick={() => setSheetOpen(true)}>
            Open a sheet
          </Button>
          <Dialog
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title="Add MCP server"
            width="30rem"
            footer={
              <>
                <Button variant="ghost" onClick={() => setSheetOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" onClick={() => setSheetOpen(false)}>
                  Add server
                </Button>
              </>
            }
          >
            <div className="flex flex-col gap-3.5">
              <label className="flex flex-col gap-1.5">
                <span className="text-caption text-muted-foreground">Name</span>
                <TextField value={name} onChange={setName} placeholder="What the menu calls it" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-caption text-muted-foreground">Command</span>
                <TextField value={url} onChange={setUrl} placeholder="npx" className="font-mono" />
              </label>
            </div>
          </Dialog>
        </Specimen>
      </Card>
    </Section>
  )
}

function StatesSection() {
  return (
    <Section
      title="States"
      note="Loading draws nothing outside the conversation; the rows arrive. Failure names the cause verbatim and offers the remedy as a control. Empty says so plainly."
    >
      <Card>
        <Specimen label="failed">
          <StateNote
            title="Could not read the providers."
            detail="The request was refused: connection refused (os error 111)."
            action={
              <Button variant="secondary" size="sm">
                Try again
              </Button>
            }
          />
        </Specimen>
        <Specimen label="empty">
          <p className="text-ui text-muted-foreground">Nothing archived.</p>
        </Specimen>
      </Card>
    </Section>
  )
}

/** One register per tile. The translucent ones sit on the card's own surface, as they always do. */
function Swatch({ token, className, note }: { token: string; className: string; note: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className={`h-12 rounded-md border border-border ${className}`} />
      <div className="min-w-0">
        <p className="truncate text-caption text-foreground">{token}</p>
        <p className="text-micro text-muted-foreground">{note}</p>
      </div>
    </div>
  )
}

function ColourSection() {
  return (
    <Section
      title="Colour registers"
      note="Monochrome on purpose. White is the ground, ink is the primary, and the greys are registers with different jobs — not one secondary."
    >
      <Card>
        <div className="grid grid-cols-4 gap-4">
          <Swatch token="--surface" className="bg-surface" note="the paper" />
          <Swatch token="--surface-sunken" className="bg-surface-sunken" note="the plane behind" />
          <Swatch token="--surface-raised" className="bg-surface-raised" note="the plane in front" />
          <Swatch token="--muted" className="bg-muted" note="opaque grounds: chips, code, bones" />
          <Swatch token="--code-surface" className="bg-code-surface" note="inset code panel" />
          <Swatch token="--tint" className="bg-tint" note="hover — translucent on purpose" />
          <Swatch token="--selected" className="bg-selected" note="selection and press" />
          <Swatch token="--hairline" className="bg-hairline" note="every border, 1px" />
          <Swatch token="--foreground" className="bg-foreground" note="ink" />
          <Swatch
            token="--muted-foreground"
            className="bg-muted-foreground"
            note="secondary text, every mark"
          />
          <Swatch token="--primary" className="bg-primary" note="the primary action" />
          <Swatch token="--danger" className="bg-danger" note="the one hue, quiet at rest" />
          <Swatch token="--diff-add" className="bg-diff-add" note="added" />
          <Swatch token="--diff-del" className="bg-diff-del" note="removed — danger itself" />
        </div>
      </Card>
    </Section>
  )
}

function TypeSection() {
  return (
    <Section
      title="Type roles"
      note="One scale, driven by the Text control above. Hierarchy comes from weight, colour and tracking — the sizes only separate genuine tasks."
    >
      <Card>
        <div className="flex flex-col gap-2">
          <p className="text-micro text-foreground">Micro — the label under a control</p>
          <p className="text-caption text-foreground">Caption — secondary lines, states, notes</p>
          <p className="text-ui text-foreground">Interface — buttons, rows, fields</p>
          <p className="text-body text-foreground">Body — what the transcript reads at</p>
          <p className="text-title text-foreground">Title — a section's heading</p>
          <p className="studio-heading text-foreground">Heading — a sheet's title voice</p>
          <p className="studio-display text-foreground">Display — the serif, arriving once</p>
          <p className="text-code font-mono text-foreground">Code — one step under its sentence, always</p>
        </div>
      </Card>
    </Section>
  )
}

const ELEVATION = [
  { token: 'shadow-chip', note: 'a thumb inside a track' },
  { token: 'shadow-raised', note: 'the resting composer' },
  { token: 'shadow-lifted', note: 'the focused composer' },
  { token: 'shadow-overlay', note: 'a menu or popover' },
  { token: 'shadow-modal', note: 'a dialog over a scrim' },
] as const

function ElevationSection() {
  return (
    <Section
      title="Elevation"
      note="Five steps, no hand-written shadows. Depth is the plane ordering plus a hairline; the shadow only agrees with it."
    >
      <Card>
        <div className="flex flex-wrap gap-4">
          {ELEVATION.map((step) => (
            <div key={step.token} className="flex w-40 flex-col gap-1.5">
              <div className={`flex h-16 items-center justify-center rounded-lg border border-border bg-surface ${step.token}`}>
                <span className="font-mono text-code text-muted-foreground">{step.token}</span>
              </div>
              <p className="text-micro text-muted-foreground">{step.note}</p>
            </div>
          ))}
        </div>
      </Card>
    </Section>
  )
}

function CollapseDemo() {
  const [open, setOpen] = useState(true)
  return (
    <Specimen label="collapse">
      <Button variant="secondary" size="sm" onClick={() => setOpen((current) => !current)}>
        {open ? 'Collapse' : 'Expand'}
      </Button>
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            {...COLLAPSE}
            className="w-64 overflow-hidden rounded-lg border border-border bg-surface-sunken px-3 py-2"
          >
            <p className="text-caption text-muted-foreground">
              A measured height — the one place a spring is genuinely wrong, because overshoot
              on an auto height reflows everything below it.
            </p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Specimen>
  )
}

function FadeDemo() {
  const [shown, setShown] = useState(true)
  return (
    <Specimen label="fade">
      <Button variant="secondary" size="sm" onClick={() => setShown((current) => !current)}>
        {shown ? 'Remove' : 'Appear'}
      </Button>
      <AnimatePresence>
        {shown ? (
          <motion.div
            {...FADE}
            className="flex w-64 items-center justify-center rounded-lg border border-border bg-surface-sunken px-3 py-3"
          >
            <p className="text-caption text-muted-foreground">base duration, ease-out</p>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Specimen>
  )
}

const MOVES: readonly { id: SurfaceMove; label: string }[] = [
  { id: 'push', label: 'Push' },
  { id: 'pop', label: 'Pop' },
  { id: 'sibling', label: 'Sibling' },
]

function SurfaceDemo() {
  const [move, setMove] = useState<SurfaceMove>('push')
  const [turn, setTurn] = useState(0)
  const variants = surfaceVariants()

  return (
    <Specimen label="surfaces">
      <div className="flex items-center gap-2">
        {MOVES.map((option) => (
          <Button
            key={option.id}
            variant={option.id === move ? 'primary' : 'secondary'}
            size="sm"
            onClick={() => {
              setMove(option.id)
              setTurn((current) => current + 1)
            }}
          >
            {option.label}
          </Button>
        ))}
      </div>
      <AnimatePresence custom={move} initial={false} mode="popLayout">
        <motion.div
          key={turn}
          custom={move}
          variants={variants}
          initial="initial"
          animate="animate"
          exit="exit"
          className="flex w-64 items-center justify-center rounded-lg border border-border bg-surface-sunken px-3 py-3"
        >
          <p className="text-caption text-muted-foreground">
            {move} — the move rides `custom`, so the exiting surface plays the same gesture it
            arrived by.
          </p>
        </motion.div>
      </AnimatePresence>
    </Specimen>
  )
}

function MotionSection() {
  return (
    <Section
      title="Motion"
      note="Three durations, three springs, one ceiling. Things you moved spring; things that appear or vanish ease; nothing exceeds ~300ms."
    >
      <Card>
        <div className="flex flex-wrap gap-x-8 gap-y-2">
          <p className="text-caption text-muted-foreground">
            <span className="font-mono text-code text-foreground">fast {DURATION.fast}s</span> —
            hover, a chip
          </p>
          <p className="text-caption text-muted-foreground">
            <span className="font-mono text-code text-foreground">base {DURATION.base}s</span> —
            entering and leaving
          </p>
          <p className="text-caption text-muted-foreground">
            <span className="font-mono text-code text-foreground">slow {DURATION.slow}s</span> — a
            whole surface
          </p>
          <p className="text-caption text-muted-foreground">
            <span className="font-mono text-code text-foreground">
              panel {SPRING_PANEL.stiffness}/{SPRING_PANEL.damping}
            </span>{' '}
            ·{' '}
            <span className="font-mono text-code text-foreground">
              snappy {SPRING_SNAPPY.stiffness}/{SPRING_SNAPPY.damping}
            </span>{' '}
            ·{' '}
            <span className="font-mono text-code text-foreground">
              surface {SPRING_SURFACE.stiffness}/{SPRING_SURFACE.damping}
            </span>
          </p>
        </div>
        <CollapseDemo />
        <FadeDemo />
        <SurfaceDemo />
      </Card>
    </Section>
  )
}

