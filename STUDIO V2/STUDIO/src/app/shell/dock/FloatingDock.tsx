import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { StudioMark } from '@/components/brand/StudioMark'
import { findView, type View, type ViewEntry } from '@/app/navigation/views'
import { useNavigation } from '@/app/navigation/NavigationProvider'
import { DOCK_CATEGORIES, type DockCategory } from '@/app/shell/dock/dockCategories'
import { DockThemeToggle } from '@/app/shell/dock/DockThemeToggle'
import { SHELL } from '@/app/shell/shellConfig'
import { Expand } from '@/components/icons'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

/**
 * The floating dock — top-centre, and the app's only menu. There is no menu
 * bar and no sidebar nav: every destination in the app is reached from here,
 * which is why the category grouping in `dockCategories.ts` is the whole
 * information architecture rather than a cosmetic arrangement.
 */
export function FloatingDock() {
  const { view, setView } = useNavigation()

  return (
    <DockFrame>
      <DockNavigation currentView={view} onNavigate={setView} />
    </DockFrame>
  )
}

/** The pill itself: fixed to the top band, centred, and self-sizing. */
function DockFrame({ children }: { children: ReactNode }) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-40 flex items-center justify-center"
      style={{ height: SHELL.dock.bandHeight }}
    >
      <motion.div
        layout
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{
          duration: 0.18,
          ease: 'easeOut',
          layout: { type: 'spring', stiffness: 420, damping: 34 },
        }}
        style={{ minHeight: SHELL.dock.pillMinHeight }}
        /* Genuinely translucent: content passing under the dock stays legible
           through it. The blur and the hairline are what keep the pill readable
           at this opacity — without them the label text fights the page. */
        className="pointer-events-auto flex items-center gap-1 rounded-full border border-border/60 bg-background/55 px-1.5 shadow-lg ring-1 ring-black/[0.02] backdrop-blur-2xl backdrop-saturate-150 dark:bg-background/45 dark:ring-white/5"
      >
        {children}
      </motion.div>
    </div>
  )
}

function DockNavigation({
  currentView,
  onNavigate,
}: {
  currentView: View
  onNavigate: (view: View) => void
}) {
  const [openKey, setOpenKey] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  // An open menu is dismissed by anything that means "I'm done here": a click
  // outside the dock, or Escape. Both listeners exist only while a menu is open.
  useEffect(() => {
    if (!openKey) return

    const onPointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpenKey(null)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenKey(null)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [openKey])

  const go = (id: View) => {
    onNavigate(id)
    setOpenKey(null)
  }

  return (
    <div ref={ref} className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Chat"
        onClick={() => go('chat')}
        className="rounded-full"
      >
        <StudioMark size={15} className="text-foreground" />
      </Button>

      <DockDivider />

      {DOCK_CATEGORIES.map((category) => (
        <CategoryMenu
          key={category.key}
          category={category}
          open={openKey === category.key}
          onToggle={() => setOpenKey((key) => (key === category.key ? null : category.key))}
          currentView={currentView}
          onNavigate={go}
        />
      ))}

      <DockDivider />

      <DockThemeToggle />
    </div>
  )
}

function DockDivider() {
  return <span aria-hidden className="mx-0.5 h-4 w-px bg-border" />
}

function CategoryMenu({
  category,
  open,
  onToggle,
  currentView,
  onNavigate,
}: {
  category: DockCategory
  open: boolean
  onToggle: () => void
  currentView: View
  onNavigate: (view: View) => void
}) {
  const entries = category.items.map(findView)
  const ownsCurrent = entries.some((entry) => entry.id === currentView)

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={onToggle}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'h-7 gap-1 rounded-full px-2.5 text-xs font-medium',
          open || ownsCurrent
            ? 'bg-muted text-foreground'
            : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )}
      >
        {category.label}
        <Expand
          size="xs"
          className={cn(
            'text-muted-foreground transition-transform duration-200',
            open && 'rotate-180',
          )}
        />
      </Button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.97 }}
            transition={{ type: 'spring', stiffness: 460, damping: 30, mass: 0.7 }}
            className="absolute left-0 top-full z-10 mt-2 w-[180px] overflow-hidden rounded-xl border border-border bg-popover p-1.5 shadow-lg"
          >
            {entries.map((entry) => (
              <CategoryMenuItem
                key={entry.id}
                entry={entry}
                active={currentView === entry.id}
                onSelect={() => onNavigate(entry.id)}
              />
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function CategoryMenuItem({
  entry,
  active,
  onSelect,
}: {
  entry: ViewEntry
  active: boolean
  onSelect: () => void
}) {
  return (
    <Button
      variant="ghost"
      role="menuitem"
      disabled={!entry.ready}
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group/item flex h-auto w-full items-center justify-start gap-2.5 rounded-lg px-2 py-1.5 text-left',
        active && 'bg-muted',
      )}
    >
      <entry.icon
        size="sm"
        className={cn(
          'shrink-0 transition-colors',
          active ? 'text-foreground' : 'text-muted-foreground group-hover/item:text-foreground',
        )}
      />
      <span
        className={cn(
          'flex-1 text-xs transition-colors',
          active
            ? 'font-medium text-foreground'
            : 'text-muted-foreground group-hover/item:text-foreground',
        )}
      >
        {entry.label}
      </span>
      {!entry.ready && <span className="text-[10px] text-muted-foreground/70">soon</span>}
    </Button>
  )
}
