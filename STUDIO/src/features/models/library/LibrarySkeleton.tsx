import { Placeholder, PlaceholderMark, PlaceholderText } from '@/components/placeholder'

/**
 * The library before the catalog arrives.
 *
 * The bones hold both columns the catalog will fill - the index's mark-and-
 * name rows on the left, the search field and the family cards on the right -
 * so opening the library before the harness answers shows the room, not a
 * gap. One `role="status"` over the whole region; the bones are aria-hidden
 * by the primitives. The small transient menus keep their sentence
 * (`CatalogStateNote`): a popover that lives for a moment wants a word, not a
 * wireframe.
 */
export function LibrarySkeleton() {
  return (
    <div role="status" aria-label="Loading models" className="flex h-full min-h-0 text-ui">
      <div className="flex w-52 shrink-0 flex-col gap-0.5 border-r pr-3 max-[48rem]:w-13">
        {['56%', '64%', '44%', '58%', '38%'].map((width) => (
          <div
            key={width}
            className="flex items-center gap-1.5 rounded-md px-2 py-1.5 max-[48rem]:justify-center max-[48rem]:px-0"
          >
            <PlaceholderMark size={13} />
            <PlaceholderText width={width} className="max-[48rem]:hidden" />
          </div>
        ))}
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 pl-4">
        <Placeholder className="h-7 w-full shrink-0 rounded-md" />
        <PlaceholderText className="w-1/3" />
        <div className="grid grid-cols-[repeat(auto-fill,minmax(11.5rem,1fr))] gap-1.5">
          {[
            'w-3/5',
            'w-1/2',
            'w-2/5',
            'w-3/5',
            'w-1/2',
            'w-2/5',
          ].map((nameWidth, index) => (
            <div key={index} className="flex items-start gap-2.5 rounded-lg p-3">
              <PlaceholderMark size={16} className="relative" />
              <div className="min-w-0 flex-1 space-y-1.5 pt-0.5">
                <PlaceholderText className={nameWidth} />
                <PlaceholderText className="w-1/3" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
