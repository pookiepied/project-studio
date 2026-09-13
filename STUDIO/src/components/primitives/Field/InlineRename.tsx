import { useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'

/**
 * A title edited where it is shown.
 *
 * Enter and blur commit, Escape abandons, and the field opens with its text
 * selected so the common rename -- type a whole new name -- is one keystroke
 * from the first letter. The draft is the field's own: the caller decides
 * when editing starts and what happens to the committed words, and nothing
 * else, which is what let the sidebar row and the identity line stop each
 * carrying a draft, a ref and the same three key handlers.
 *
 * `fit` sizes the field to its content, for a line that must not jump width
 * on becoming editable; without it the field fills its row.
 */
export function InlineRename({
  initial,
  onCommit,
  onCancel,
  fit = false,
  className,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
  fit?: boolean
  className?: string
}) {
  const [draft, setDraft] = useState(initial)
  const field = useRef<HTMLInputElement>(null)

  useEffect(() => {
    field.current?.select()
  }, [])

  return (
    <input
      ref={field}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => onCommit(draft)}
      onKeyDown={(event) => {
        if (event.key === 'Enter') onCommit(draft)
        if (event.key === 'Escape') onCancel()
      }}
      size={fit ? Math.max(draft.length, 14) : undefined}
      className={cn('bg-selected text-ui text-foreground outline-none', fit ? null : 'w-full', className)}
    />
  )
}
