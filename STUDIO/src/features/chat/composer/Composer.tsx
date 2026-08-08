import { useState } from 'react'
import { Attach, Microphone } from '@/components/icons'
import { ComposerInput } from '@/features/chat/composer/ComposerInput'
import { SendButton } from '@/features/chat/composer/SendButton'
import { toolbarGroup } from '@/features/chat/composer/composerStyles'
import { ModelReasoningControl } from '@/features/chat/composer/controls/ModelReasoningControl'
import { PendingAction } from '@/features/chat/composer/controls/PendingAction'
import { PermissionSelector } from '@/features/chat/composer/controls/PermissionSelector'
import { DEFAULT_TURN_SETTINGS } from '@/features/chat/composer/turnSettings'
import type { ChatStatus, TurnSettings } from '@/features/chat/session/types'

/**
 * Composition root for the composer: a field over a toolbar row.
 *
 * It owns the draft text and the turn settings, and nothing else. Each control
 * in the toolbar is its own module, so adding one is a new file plus a line
 * here rather than an edit to a growing component.
 */
export function Composer({
  status,
  onSend,
  onStop,
}: {
  status: ChatStatus
  onSend: (text: string, settings: TurnSettings) => void
  onStop: () => void
}) {
  const [text, setText] = useState('')
  const [settings, setSettings] = useState<TurnSettings>(DEFAULT_TURN_SETTINGS)

  const busy = status === 'submitting' || status === 'thinking' || status === 'streaming'
  const canSend = text.trim().length > 0 && !busy

  const submit = () => {
    if (!canSend) return
    onSend(text.trim(), settings)
    setText('')
  }

  return (
    <div className="rounded-2xl border border-border bg-card shadow-sm transition-colors focus-within:border-ring/60">
      <ComposerInput value={text} onChange={setText} onSubmit={submit} />

      <div className="flex items-center gap-1 px-2 pb-2">
        <div className={toolbarGroup}>
          <PendingAction
            icon={Attach}
            label="Attach files"
            reason="Attachments arrive with the files slice."
          />
          <PendingAction
            icon={Microphone}
            label="Voice input"
            reason="Voice input arrives with the transcription slice."
          />
        </div>

        <div className={`${toolbarGroup} ml-auto`}>
          <PermissionSelector
            permission={settings.permission}
            onChange={(permission) => setSettings((current) => ({ ...current, permission }))}
          />
          <ModelReasoningControl
            modelId={settings.modelId}
            effort={settings.effort}
            onModelChange={(modelId) => setSettings((current) => ({ ...current, modelId }))}
            onEffortChange={(effort) => setSettings((current) => ({ ...current, effort }))}
          />
          <SendButton status={status} canSend={canSend} onSend={submit} onStop={onStop} />
        </div>
      </div>
    </div>
  )
}
