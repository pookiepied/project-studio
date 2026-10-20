import { useState } from 'react'
import { Icons } from '@/components/icons'
import { Popover } from '@/components/primitives'

/** Provider messages can be paragraphs; keep them outside the control row. */
export function VoiceFailure({ label, note }: { label: string; note: string }) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      className="w-80 p-3"
      trigger={
        <button
          type="button"
          aria-label={`${label} details`}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex min-w-0 max-w-44 items-center gap-1 text-caption text-muted-foreground hover:text-foreground"
        >
          <span role="status" className="truncate">{label}</span>
          <Icons.more size="sm" className="shrink-0" />
        </button>
      }
    >
      <p className="max-h-[min(16rem,calc(100dvh-3rem))] overflow-y-auto whitespace-pre-wrap text-caption text-foreground [overflow-wrap:anywhere]">
        {note}
      </p>
    </Popover>
  )
}
