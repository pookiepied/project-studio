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
 * (home, a project page) it is the window's setting, which the first turn
 * then carries. A stored value outranking the window's is what makes the
 * picker truthful on reload: the harness holds a mode whether or not this
 * window remembers choosing it.
 */
export function PermissionControl({ conversationId }: { conversationId: string | null }) {
  const { conversations, settings, setSettings, setConversationPermission } = useWorkspace()
  const [open, setOpen] = useState(false)

  const conversation =
    conversationId === null
      ? undefined
      : conversations.find((candidate) => candidate.id === conversationId)
  // A conversation the store has never heard of cannot have a stored mode,
  // and the window's setting is the truth.
  const mode = findPermissionMode(conversation?.permissionMode ?? settings.permission)
  const Mark = PERMISSION_MODE_ICONS[mode.id]
  const loud = mode.id === 'auto'

  const pick = (candidate: PermissionMode) => {
    if (conversation === undefined) setSettings({ ...settings, permission: candidate })
    else setConversationPermission(conversation.id, candidate)
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
          className={loud && !open ? 'bg-tint hover:bg-selected' : undefined}
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
