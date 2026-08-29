import { ProviderMark } from '@/components/icons'
import type { CatalogModel } from '@/domain/models/catalog'
import { connectionsOf, familyName, type CatalogFamily } from '@/domain/models/families'
import { ModelRow } from './ModelRow'

/**
 * The library with a needle in it: every match, grouped by family.
 *
 * Search is the one way to browse across families at once, so it shows its
 * own grouping rather than a flat list - the family header is what turns
 * "claude-sonnet" results into an answer about where a model comes from.
 * The headers are labels, not doors: the index to the left is the way into a
 * family, and a header that navigated too would put the same move one click
 * apart under two different hands.
 */
export function SearchResults({
  query,
  families,
  onSelect,
}: {
  query: string
  families: readonly CatalogFamily[]
  onSelect: (model: CatalogModel) => void
}) {
  if (families.length === 0) {
    return (
      <p className="px-2 py-2 text-ui text-muted-foreground">{`No models match "${query}".`}</p>
    )
  }

  return (
    <div className="py-1">
      {families.map((family) => {
        const connections = connectionsOf(family)
        const multi = connections.length > 1
        return (
          <section key={family.author}>
            <header className="flex items-center gap-1.5 px-2 pb-1 pt-3">
              <ProviderMark provider={family.author} className="relative shrink-0" />
              <h3 className="min-w-0 truncate text-ui font-medium text-foreground">
                {familyName(family.author)}
              </h3>
              <span className="text-caption text-muted-foreground">
                {family.models.length === 1 ? '1 model' : `${family.models.length} models`}
              </span>
            </header>
            <div className="flex flex-col">
              {family.models.map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  via={multi}
                  onSelect={() => onSelect(model)}
                />
              ))}
            </div>
          </section>
        )
      })}
    </div>
  )
}
