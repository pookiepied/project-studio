import { Icons } from '@/components/icons'
import { Tooltip } from '@/components/primitives'
import { ProviderMark } from '@/features/models/ProviderMark'
import type { CatalogModel } from '@/domain/models/catalog'
import { contextHint, priceHint, rowCapabilities, type RowCapability } from './format'

/**
 * One model, as a connection's page or a search result states it.
 *
 * ---- What a row claims, and what it leaves to the page ---------------------
 *
 * The decision a row serves is "which of these is worth a look": whose model
 * it is (the mark, unless a family heading above already says), its name,
 * what it can do that its neighbours cannot
 * (three marks at most), the context it holds and what it costs. Everything
 * else - the full capability board, the cache prices, the exact context
 * figure - belongs to the detail page, one click away. A row that carried
 * all of it would be the detail page, twenty times over.
 *
 * ---- Why the columns are fixed ---------------------------------------------
 *
 * The capabilities, the context and the price each sit in a column of their
 * own width, so a page of rows reads down as a table and not across as a
 * sentence per row. The old row let every fact float after the name, and a
 * row saying "vision reasoning 131k $0.3 / $0.9" beside one saying "1M $1.2
 * / $4" put the same fact in a different place on every line.
 */
export function ModelRow({
  model,
  mark = true,
  onSelect,
}: {
  model: CatalogModel
  /** Whether the row wears its author's mark - false under a heading that already does. */
  mark?: boolean
  onSelect: () => void
}) {
  const context = contextHint(model.contextWindow)
  const price = priceHint(model.pricing.input, model.pricing.output)
  const capabilities = rowCapabilities(model)

  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors duration-fast hover:bg-tint"
    >
      {mark ? <ProviderMark provider={model.author} className="relative shrink-0" /> : null}
      <span className="min-w-0 flex-1 truncate text-ui text-foreground">{model.name}</span>
      {/* Right-aligned inside a fixed column, so a row with one mark and a
          row with three keep the same right edge. */}
      <span className="flex w-14 shrink-0 items-center justify-end gap-1.5 max-[40rem]:hidden">
        {capabilities.map((capability) => (
          <CapabilityMark key={capability.id} capability={capability} />
        ))}
      </span>
      {/* Tabular figures, so a column of prices does not shimmer as the
          eye moves down it. */}
      <span className="w-9 shrink-0 text-right text-micro tabular-nums text-muted-foreground">
        {context}
      </span>
      <span className="w-20 shrink-0 text-right text-micro tabular-nums text-muted-foreground">
        {price}
      </span>
    </button>
  )
}

/** One capability as a mark with its name behind it, for a row to vouch with. */
function CapabilityMark({ capability }: { capability: RowCapability }) {
  const Mark =
    capability.id === 'tools' ? Icons.toolCalling : capability.id === 'vision' ? Icons.vision : Icons.thinking
  return (
    <Tooltip label={capability.label}>
      <span className="flex text-muted-foreground" aria-label={capability.label} role="img">
        <Mark size="sm" />
      </span>
    </Tooltip>
  )
}
