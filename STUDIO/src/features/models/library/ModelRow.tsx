import type { CatalogModel } from '@/domain/models/catalog'
import { contextHint, priceHint, rowCapabilities } from './format'

/**
 * One model, as a family page or a search result states it.
 *
 * ---- What a row claims, and what it leaves to the page ---------------------
 *
 * The decision a row serves is "which of these is worth a look": the name,
 * the context it holds, what it costs to run it, and the two or three
 * capabilities that actually separate siblings in a family. Everything else -
 * the full capability board, the cache prices, the exact context figure -
 * belongs to the detail page, one click away. A row that carried all of it
 * would be the detail page, twenty times over.
 *
 * The family's mark is deliberately absent: the row sits under the family's
 * own header, and repeating the mark per row is the duplication this
 * hierarchy exists to remove.
 */
export function ModelRow({
  model,
  via,
  onSelect,
}: {
  model: CatalogModel
  /** Whether to name the connection - true when the family is served by more than one. */
  via: boolean
  onSelect: () => void
}) {
  const context = contextHint(model.contextWindow)
  const price = priceHint(model.pricing.input, model.pricing.output)
  const capabilities = rowCapabilities(model)

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full flex-col rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-tint"
    >
      {/* Baseline, not centre: the name is text-ui and the metadata is micro,
          and their line boxes are different heights. Aligning baselines puts
          every run on one optical line whatever its size. */}
      <span className="flex items-baseline gap-2">
        <span className="min-w-0 flex-1 truncate text-ui text-foreground">{model.name}</span>
        {capabilities.map((word) => (
          <span key={word} className="shrink-0 text-micro text-muted-foreground">
            {word}
          </span>
        ))}
        {/* Tabular figures, so a column of prices does not shimmer as the
            eye moves down it. */}
        {context !== '' ? (
          <span className="shrink-0 text-micro tabular-nums text-muted-foreground">{context}</span>
        ) : null}
        {price !== '' ? (
          <span className="shrink-0 text-micro tabular-nums text-muted-foreground">{price}</span>
        ) : null}
      </span>
      {via ? (
        <span className="truncate text-caption text-muted-foreground">
          via {model.connectionName}
        </span>
      ) : null}
    </button>
  )
}
