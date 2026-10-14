import { Icons } from '@/components/icons'

/**
 * The documents this turn will carry, resting above the field beside the
 * pictures.
 *
 * A chip, not a thumbnail: a document has no picture to show, and what a
 * person checks before sending is the name and the size - the wrong PDF is
 * noticed by its name. The file itself stays in memory until the send, when
 * it is uploaded ahead of the words. Before then, its bytes are read only
 * when a file of the same size is already held and needs a duplicate check.
 */
export function PendingDocuments({
  documents,
  onRemove,
  onKeep,
}: {
  documents: readonly File[]
  onRemove: (index: number) => void
  /** "Keep in the library": the same offer a picture's thumbnail carries. */
  onKeep?: (index: number) => void
}) {
  if (documents.length === 0) return null
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {documents.map((document, index) => (
        <span
          key={`${document.name}-${document.size}-${index}`}
          className="group inline-flex max-w-72 items-center gap-1.5 rounded-full border bg-surface-raised py-1 pl-2.5 pr-1 text-caption text-foreground"
        >
          <Icons.file size="sm" />
          <span className="truncate">{document.name}</span>
          <span className="shrink-0 text-muted-foreground">{formatBytes(document.size)}</span>
          {onKeep !== undefined ? (
            <button
              type="button"
              aria-label={`Keep ${document.name} in the library`}
              title="Keep in the library"
              onClick={() => onKeep(index)}
              className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
            >
              <Icons.keep size="sm" />
            </button>
          ) : null}
          <button
            type="button"
            aria-label={`Remove ${document.name}`}
            onClick={() => onRemove(index)}
            className="flex size-5 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors duration-fast hover:bg-tint hover:text-foreground"
          >
            <Icons.close size="sm" />
          </button>
        </span>
      ))}
    </div>
  )
}

function formatBytes(size: number): string {
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}
