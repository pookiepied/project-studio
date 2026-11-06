import { useState } from 'react'
import { IconButton, MenuItem, MenuLabel, Popover } from '@/components/primitives'
import { PERMISSION_MODE_ICONS } from '@/features/chat/permissions/modeIcon'
import { PERMISSION_MODES, findPermissionMode, type PermissionMode } from '@/domain/permissions/modes'
import { useWorkspace } from '@/stores/workspace'

/*
 * ---- Which mode this is ----------------------------------------------------
 *
 * The mode is held per conversation on the harness - it is read at every
 * permission decision - so with a conversation open the picker shows that
 * conversation's stored mode and writes a change straight into the index,
 * the same way the model picker does. On a surface with no conversation
 * (home, a project page) the draft starts from the saved default and may
 * override it for its first turn.
 */
export function PermissionControl({ conversationId, draftPermission }: {
  conversationId: string | null
  draftPermission?: { value: PermissionMode; onChange: (value: PermissionMode) => void }
}) {
  const { conversations, settings, setConversationPermission } = useWorkspace()
  const [open, setOpen] = useState(false)

  const conversation =
    conversationId === null
      ? undefined
      : conversations.find((candidate) => candidate.id === conversationId)
  const mode = findPermissionMode(conversation?.permissionMode ?? draftPermission?.value ?? settings.permission)
  const Mark = PERMISSION_MODE_ICONS[mode.id]
  const loud = mode.id === 'auto'

  const pick = (candidate: PermissionMode) => {
    if (conversationId === null) draftPermission?.onChange(candidate)
    else setConversationPermission(conversationId, candidate)
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      className="w-64"
      trigger={
        <IconButton
          label={`What Studio may do: ${mode.name}`}
          active={open}
          className={`focus-visible:outline-none! focus-visible:bg-selected ${loud && !open ? 'bg-tint hover:bg-selected' : ''}`}
          onClick={() => setOpen(!open)}
        >
          <Mark size="md" />
        </IconButton>
      }
    >
      <MenuLabel>What Studio may do</MenuLabel>
      {PERMISSION_MODES.map((candidate) => (
        <MenuItem
          key={candidate.id}
          selected={candidate.id === mode.id}
          note={candidate.note}
          onSelect={() => pick(candidate.id)}
        >
          {candidate.name}
        </MenuItem>
      ))}
    </Popover>
  )
}
