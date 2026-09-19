import { Icons } from '@/components/icons'
import { NavRow } from '@/components/primitives'
import { ProviderMark } from '@/features/models/ProviderMark'
import type { CatalogConnection } from '@/domain/models/connections'
import { familyGroups, familyName } from '@/domain/models/families'

/**
 * The library's landing: one row per connection, and what each one holds.
 *
 * ---- Why rows, and why this is the opening page ----------------------------
 *
 * The first question about a catalog is "what is here" - which connections,
 * what is behind each - and not "show me every model". Answering it with
 * the full list is how the library once opened: an aggregator's three
 * hundred rows before a single fact sorted them. The rows are the sorted
 * facts. Each is the connection's mark, the name the person gave it, how
 * many models it holds, and whose models they are - "Anthropic, Google,
 * OpenAI and 40 more" - which is the line that tells OpenRouter apart from
 * Cerebras at a glance and previews the page behind the row. It used to be
 * a grid of cards beside an index that named the same things again; in a
 * window this size one list is the whole page.
 *
 * The way to more models is the last row, in the same shape as the others:
 * the landing says where the catalog comes from, and that includes where it
 * grows.
 */
export function ConnectionList({
  connections,
  onSelect,
  onOpenSettings,
}: {
  connections: readonly CatalogConnection[]
  onSelect: (id: string) => void
  onOpenSettings: () => void
}) {
  return (
    <div className="flex flex-col py-1">
      {connections.length === 0 ? (
        // Said once, pointing at the one place that fixes it - an absence
        // naming itself, not styled as a failure.
        <p className="px-2 py-2 text-ui text-muted-foreground">No models to browse yet.</p>
      ) : (
        connections.map((connection) => (
          <ConnectionRow key={connection.id} connection={connection} onSelect={onSelect} />
        ))
      )}
      <NavRow icon={<Icons.settings />} className="mt-2 w-fit" onClick={onOpenSettings}>
        Add models in Settings…
      </NavRow>
    </div>
  )
}

/** How many families are named before the rest are counted. */
const NAMED_FAMILIES = 3

/**
 * Whose models a connection holds, as one line: the first few by name and
 * the rest as a count. Families are in name order, the same order the
 * page behind the row lists them in. Empty for a direct connection whose
 * models are all its own - "Google" under Google is the name said twice.
 */
function familyLine(connection: CatalogConnection): string {
  const families = familyGroups(connection.models)
  if (families.length === 1 && families[0]?.author === connection.vendor) return ''
  const names = families.map((family) => familyName(family.author))
  const named = names.slice(0, NAMED_FAMILIES)
  const rest = names.length - named.length
  if (rest === 0) return named.join(', ')
  return `${named.join(', ')} and ${rest} more`
}

function ConnectionRow({
  connection,
  onSelect,
}: {
  connection: CatalogConnection
  onSelect: (id: string) => void
}) {
  const line = familyLine(connection)
  return (
    <button
      type="button"
      onClick={() => onSelect(connection.id)}
      className="flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left transition-colors duration-fast hover:bg-tint"
    >
      {/* Centred on the name's own line: the wrapper is exactly one line of
          the text role beside it, per the rules for a mark on the first line
          of a multi-line block. */}
      <span className="flex h-[1lh] items-center text-ui">
        <ProviderMark provider={connection.vendor} size="md" className="relative" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className="min-w-0 flex-1 truncate text-ui font-medium text-foreground">
            {connection.name}
          </span>
          <span className="shrink-0 text-micro tabular-nums text-muted-foreground">
            {connection.models.length === 1 ? '1 model' : `${connection.models.length} models`}
          </span>
        </span>
        {line !== '' ? (
          <span className="block truncate text-caption text-muted-foreground">{line}</span>
        ) : null}
      </span>
      <span className="flex h-[1lh] items-center text-ui">
        <Icons.disclosure size="sm" className="text-muted-foreground" />
      </span>
    </button>
  )
}
