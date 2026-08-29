import { Placeholder, PlaceholderMark, PlaceholderText } from '@/components/placeholder'

/**
 * The model list, before the catalog arrives.
 *
 * Used where models are listed on a surface built for reading -- the library
 * dialog. The small transient menus keep their sentence (`CatalogStateNote`):
 * a popover that lives for a moment wants a word, not a wireframe. Here the
 * group label and the rows -- mark, name, context hint -- hold the shape the
 * catalog will fill, so opening the library before the harness answers shows
 * the room, not a gap.
 */
export function ModelListSkeleton() {
  return (
    <div role="status" aria-label="Loading models" className="py-1 text-ui">
      <div className="px-2 py-1.5">
        <Placeholder className="h-[1.2em] w-[32%] rounded-md" />
      </div>
      <div className="flex flex-col">
        {[
          { name: '47%', hint: '8%' },
          { name: '61%', hint: '8%' },
          { name: '38%', hint: '8%' },
          { name: '54%', hint: '8%' },
        ].map((row) => (
          <div key={row.name} className="flex items-center gap-2 px-2 py-1.5">
            <PlaceholderMark size={14} />
            <PlaceholderText className={row.name} />
            <Placeholder className="h-[0.9em] shrink-0 rounded-full" style={{ width: row.hint }} />
          </div>
        ))}
      </div>
    </div>
  )
}
