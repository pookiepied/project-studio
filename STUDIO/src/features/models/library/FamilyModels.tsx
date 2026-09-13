import { ProviderMark } from '@/features/models/ProviderMark'
import type { CatalogModel } from '@/domain/models/catalog'
import { connectionsOf, familyName, type CatalogFamily } from '@/domain/models/families'
import { ModelRow } from './ModelRow'

/**
 * One family's page: who it is, and every model wearing its mark.
 *
 * The header is the family's own facts, stated once - its mark, its name,
 * how many models it holds, and the connections serving it when there is
 * more than one. The rows then repeat none of that: this is the level where
 * the family stops being the question and starts being the context, so each
 * row spends its space on what separates one model from the next.
 */
export function FamilyModels({
  family,
  onSelect,
}: {
  family: CatalogFamily
  onSelect: (model: CatalogModel) => void
}) {
  const connections = connectionsOf(family)
  const multi = connections.length > 1

  return (
    <div className="py-1">
      <header className="flex items-start gap-2.5 px-2 pb-3 pt-1">
        <span className="flex h-[1lh] items-center text-ui">
          <ProviderMark provider={family.author} size="md" className="relative" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <h3 className="text-ui font-medium text-foreground">{familyName(family.author)}</h3>
            <span className="text-caption text-muted-foreground">
              {family.models.length === 1 ? '1 model' : `${family.models.length} models`}
            </span>
          </div>
          {multi ? (
            <p className="truncate text-caption text-muted-foreground">
              via {connections.join(' · ')}
            </p>
          ) : null}
        </div>
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
    </div>
  )
}
