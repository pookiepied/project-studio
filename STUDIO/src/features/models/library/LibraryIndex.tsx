import { Icons, ProviderMark } from '@/components/icons'
import { SelectionChip } from '@/components/primitives'
import { familyName, type CatalogFamily } from '@/domain/models/families'
import { cn } from '@/lib/cn'

/**
 * The library's index: the landing above the families, one row per family.
 *
 * ---- Why an index at all ---------------------------------------------------
 *
 * The old library was one continuous list grouped by connection, which made
 * an aggregator's two hundred rows a wall and buried the fact that a catalog
 * has shape - a handful of vendors, each holding a handful of models. The
 * index is that shape, stated once: the families are the library's first
 * axis, and every page to the right is one family deep or the landing.
 *
 * ---- Why the selection slides ---------------------------------------------
 *
 * The sidebar's selection chip is the app's established answer to "which of
 * these rows is the one I am in", and this is the same question asked of a
 * different column. Same pattern, own `layoutId`: a second chip sharing the
 * sidebar's id would give framer-motion two live elements under one name,
 * and the chip would fly between the dialog and the sidebar behind it.
 *
 * ---- Narrow windows --------------------------------------------------------
 *
 * Below a 48rem window the dialog is under 36rem wide, and 13rem of index
 * leaves the pages a sliver. The index answers by collapsing to its marks -
 * the same move the sidebar makes when it becomes a rail - keeping one
 * navigation model instead of growing a second, label-free one. The window
 * width and the dialog width move together here (the dialog is 74vw), so a
 * media query on the window is a media query on the dialog.
 */
export function LibraryIndex({
  families,
  activeFamily,
  familiesActive,
  total,
  onSelectFamily,
  onOpenFamilies,
}: {
  families: readonly CatalogFamily[]
  /** The family whose row is marked, or null while searching. */
  activeFamily: string | null
  /** Whether the landing row is the one marked - true whenever no family is. */
  familiesActive: boolean
  total: number
  onSelectFamily: (author: string) => void
  onOpenFamilies: () => void
}) {
  return (
    <nav
      aria-label="Model families"
      className="flex w-52 shrink-0 flex-col gap-0.5 border-r pr-3 max-[48rem]:w-13"
    >
      <IndexRow
        active={familiesActive}
        count={total}
        onSelect={onOpenFamilies}
        label="All families"
        // Wide, the label carries the row; narrow, the row is a mark like the
        // rest, and this is the one concept the app already draws for "the set
        // of providers a catalog draws from".
        narrow={<Icons.providers size="sm" className="relative" />}
      />
      {families.map((family) => (
        <IndexRow
          key={family.author}
          mark={family.author}
          label={familyName(family.author)}
          count={family.models.length}
          active={activeFamily === family.author}
          onSelect={() => onSelectFamily(family.author)}
        />
      ))}
    </nav>
  )
}

function IndexRow({
  mark,
  label,
  count,
  active,
  onSelect,
  narrow,
}: {
  mark?: string
  label: string
  count: number
  active: boolean
  onSelect: () => void
  /** Replaces the label when the index has collapsed to marks. */
  narrow?: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-current={active || undefined}
      onClick={onSelect}
      className={cn(
        'relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-ui transition-colors duration-fast max-[48rem]:justify-center max-[48rem]:px-0',
        active ? 'text-foreground' : 'text-muted-foreground hover:bg-tint hover:text-foreground',
      )}
    >
      {active ? (
        <SelectionChip list="library-index" />
      ) : null}
      {mark !== undefined ? <ProviderMark provider={mark} className="relative shrink-0" /> : null}
      <span className="relative min-w-0 flex-1 truncate max-[48rem]:hidden">{label}</span>
      {narrow}
      {/* The positioned chip would paint over a static sibling - see the
          sidebar's chip, which carries the same comment. */}
      <span className="relative shrink-0 text-micro tabular-nums text-muted-foreground max-[48rem]:hidden">
        {count}
      </span>
    </button>
  )
}
