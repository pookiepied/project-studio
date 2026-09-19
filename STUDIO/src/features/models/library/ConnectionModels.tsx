import { Icons } from '@/components/icons'
import { NavRow } from '@/components/primitives'
import { ProviderMark } from '@/features/models/ProviderMark'
import type { CatalogModel } from '@/domain/models/catalog'
import type { CatalogConnection } from '@/domain/models/connections'
import { familyGroups, familyName } from '@/domain/models/families'
import { ModelRow } from './ModelRow'

/**
 * One connection's page: which connection, and every model it serves,
 * under the vendors whose models they are.
 *
 * The header is the connection's own facts, stated once - its mark, the
 * name the person gave it, how many models it holds. Below it the rows are
 * grouped by author: an aggregator's three hundred models in one alphabet
 * is a wall, and the same rows under Anthropic, then Google, then OpenAI
 * are a shape. Each family's heading wears the mark, so its rows do not
 * repeat it. A connection whose models are all one vendor's - a direct
 * connection - has nothing to group, and its rows wear the mark themselves
 * under the header alone, because the header's mark is the connection's
 * and the rows' is the author's, and for a gateway added by hand those are
 * two different things.
 */
export function ConnectionModels({
  connection,
  onSelect,
  onBack,
}: {
  connection: CatalogConnection
  onSelect: (model: CatalogModel) => void
  onBack: () => void
}) {
  const families = familyGroups(connection.models)
  const grouped = families.length > 1

  return (
    <div className="flex flex-col gap-2 py-1">
      {/* Pointing back the way it came - the same turned mark every
          disclosure uses, so back reads as back and not as decoration. */}
      <NavRow icon={<Icons.disclosure className="rotate-180" />} className="w-fit" onClick={onBack}>
        All connections
      </NavRow>

      <header className="flex items-center gap-2 px-2 pb-1">
        <ProviderMark provider={connection.vendor} size="md" className="relative shrink-0" />
        <h3 className="min-w-0 truncate text-ui font-medium text-foreground">{connection.name}</h3>
        <span className="shrink-0 text-caption text-muted-foreground">
          {connection.models.length === 1 ? '1 model' : `${connection.models.length} models`}
        </span>
      </header>

      {grouped ? (
        families.map((family) => (
          <section key={family.author}>
            <header className="flex items-center gap-1.5 px-2 pb-1 pt-2">
              <ProviderMark provider={family.author} className="relative shrink-0" />
              <h4 className="min-w-0 truncate text-ui font-medium text-foreground">
                {familyName(family.author)}
              </h4>
              <span className="text-caption tabular-nums text-muted-foreground">{family.models.length}</span>
            </header>
            <div className="flex flex-col">
              {family.models.map((model) => (
                <ModelRow key={model.id} model={model} mark={false} onSelect={() => onSelect(model)} />
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="flex flex-col">
          {connection.models.map((model) => (
            <ModelRow key={model.id} model={model} onSelect={() => onSelect(model)} />
          ))}
        </div>
      )}
    </div>
  )
}
