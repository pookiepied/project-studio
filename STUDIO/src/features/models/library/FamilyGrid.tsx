import { ProviderMark } from '@/components/icons'
import type { CatalogModel } from '@/domain/models/catalog'
import { connectionsOf, familyName, type CatalogFamily } from '@/domain/models/families'

/**
 * The library's landing: one card per family, and the catalog's shape above
 * them.
 *
 * ---- Why cards, and why this is the opening page ---------------------------
 *
 * The user's first question about a catalog is "what is here" - which
 * vendors, how much of each - and not "show me every model". Answering that
 * question with the full model list is how the old library opened: an
 * aggregator's two hundred rows before a single fact sorted them. The cards
 * are the sorted facts. Each one is the family's mark, its name, how many
 * models it holds and through which connections - everything a reader needs
 * to pick a door, and nothing that belongs behind one.
 *
 * The cards are bare, like every other navigable row in the app: the grid,
 * the marks and the alignment carry the structure, and a box around each card
 * would be furniture announcing what the layout already says.
 */
export function FamilyGrid({
  families,
  models,
  connections,
  onSelect,
}: {
  families: readonly CatalogFamily[]
  models: readonly CatalogModel[]
  /** Distinct connections serving the catalog, for the stat line. */
  connections: number
  onSelect: (author: string) => void
}) {
  if (families.length === 0) {
    // Said once, pointing at the one place that fixes it - an absence naming
    // itself, not styled as a failure.
    return (
      <p className="px-2 py-2 text-ui text-muted-foreground">
        No models to browse yet. Add one in Settings.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3 py-1">
      <p className="px-2 text-caption text-muted-foreground">
        {models.length} models · {families.length} {families.length === 1 ? 'family' : 'families'} ·{' '}
        {connections} {connections === 1 ? 'connection' : 'connections'}
      </p>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-1.5">
        {families.map((family) => (
          <FamilyCard key={family.author} family={family} onSelect={onSelect} />
        ))}
      </div>
    </div>
  )
}

function FamilyCard({
  family,
  onSelect,
}: {
  family: CatalogFamily
  onSelect: (author: string) => void
}) {
  const connections = connectionsOf(family)
  return (
    <button
      type="button"
      onClick={() => onSelect(family.author)}
      className="flex items-start gap-2.5 rounded-lg p-3 text-left transition-colors duration-fast hover:bg-tint"
    >
      {/* Centred on the name's own line: the wrapper is exactly one line of
          the text role beside it, per the rules for a mark on the first line
          of a multi-line block. */}
      <span className="flex h-[1lh] items-center text-ui">
        <ProviderMark provider={family.author} size="md" className="relative" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ui font-medium text-foreground">
          {familyName(family.author)}
        </span>
        <span className="block text-caption text-muted-foreground">
          {family.models.length === 1 ? '1 model' : `${family.models.length} models`}
        </span>
        <span className="block truncate text-caption text-muted-foreground">
          {connections.join(' · ')}
        </span>
      </span>
    </button>
  )
}
