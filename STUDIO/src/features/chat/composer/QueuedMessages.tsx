import { useState } from 'react'
import { Icons } from '@/components/icons'
import { IconButton, MenuItem, Popover } from '@/components/primitives'
import type { QueuedMessage } from '@/platform/harness/client/queued-messages'

export function QueuedMessages({ messages, disabled, onAction }: {
  messages: readonly QueuedMessage[]
  disabled: boolean
  onAction: (message: QueuedMessage, action: 'steer' | 'remove' | 'edit') => void
}) {
  if (messages.length === 0) return null
  return (
    <div aria-label="Queued messages" className="mx-3 -mb-2 rounded-t-xl border border-border/50 bg-surface-raised px-3 pb-3 pt-0.5">
      {messages.map((message) => (
        <QueueRow key={message.submissionId} message={message} disabled={disabled} onAction={onAction} />
      ))}
      {messages.length === 3 ? <p className="px-1 pt-1 text-xs text-muted-foreground">Queue full (3/3)</p> : null}
    </div>
  )
}

function QueueRow({ message, disabled, onAction }: {
  message: QueuedMessage
  disabled: boolean
  onAction: (message: QueuedMessage, action: 'steer' | 'remove' | 'edit') => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="flex min-h-7 items-center gap-2 text-ui">
      <Icons.queue size="sm" className="shrink-0 text-muted-foreground" />
      <p title={message.text} className="min-w-0 flex-1 truncate">{message.text || 'Attached images'}</p>
      <button type="button" disabled={disabled} className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-tint disabled:opacity-40" title="Use in the active response at its next safe step" onClick={() => onAction(message, 'steer')}>
        <Icons.steer size="sm" /> Steer now
      </button>
      <IconButton label="Delete queued message" size="sm" disabled={disabled} onClick={() => onAction(message, 'remove')}><Icons.delete size="sm" /></IconButton>
      <Popover open={open} onOpenChange={setOpen} side="top" align="end" trigger={<IconButton label="Queued message options" size="sm" disabled={disabled} onClick={() => setOpen(!open)}><Icons.more size="sm" /></IconButton>}>
        <MenuItem icon={<Icons.edit />} onSelect={() => { setOpen(false); onAction(message, 'edit') }}>Edit message</MenuItem>
        <MenuItem icon={<Icons.delete />} onSelect={() => { setOpen(false); onAction(message, 'remove') }}>Delete message</MenuItem>
      </Popover>
    </div>
  )
}
