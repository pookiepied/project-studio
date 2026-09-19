import { ProviderMark } from '@/features/models/ProviderMark'
import type { CatalogModel } from '@/domain/models/catalog'
import type { CatalogConnection } from '@/domain/models/connections'
import { ModelRow } from './ModelRow'

/**
 * The library with a needle in it: every match, grouped by connection.
 *
 * Search is the one way to browse across connections at once, so it shows
 * its own grouping rather than a flat list - the heading is what turns two
 * "GPT OSS 120B" results into an answer about which connection each one
 * comes through. The headings are labels, not doors: the landing is the way
 * into a connection, and a heading that navigated too would put the same
 * move under two different hands.
 */
export function SearchResults({
  query,
  connections,
  onSelect,
}: {
  query: string
  connections: readonly CatalogConnection[]
  onSelect: (model: CatalogModel) => void
}) {
  if (connections.length === 0) {
    return (
      <p className="px-2 py-2 text-ui text-muted-foreground">{`No models match "${query}".`}</p>
    )
  }

  return (
    <div className="py-1">
      {connections.map((connection) => (
        <section key={connection.id}>
          <header className="flex items-center gap-1.5 px-2 pb-1 pt-3">
            <ProviderMark provider={connection.vendor} className="relative shrink-0" />
            <h3 className="min-w-0 truncate text-ui font-medium text-foreground">{connection.name}</h3>
            <span className="text-caption text-muted-foreground">
              {connection.models.length === 1 ? '1 model' : `${connection.models.length} models`}
            </span>
          </header>
          <div className="flex flex-col">
            {connection.models.map((model) => (
              <ModelRow key={model.id} model={model} onSelect={() => onSelect(model)} />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
