import { useState, type ReactNode } from 'react'
import { DisclosureRow } from '@/features/chat/transcript/DisclosureRow'

export function WorkHistory({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <div className="mb-3 min-w-0">
    <DisclosureRow open={open} onToggle={() => setOpen((value) => !value)}
      chevron="hover" flush label={<span className="truncate font-medium">{title}</span>}>
      <div className="flex min-w-0 flex-col gap-3 pb-3">{children}</div>
    </DisclosureRow>
    <hr className="mt-2 border-0 border-t border-hairline" />
  </div>
}
