import { useState } from 'react'
import { COMPOSER } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton, MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/primitives'
import { PERMISSION_MODES, findPermissionMode, type PermissionMode } from '@/domain/permissions/modes'
import { useWorkspace } from '@/stores/workspace'

/**
 * The composer's three dots: what the reference's row has no room to show.
 *
 * The mode is held per conversation on the harness, so with a conversation open
 * the menu shows that conversation's stored mode and writes a change straight
 * into the index. With none (home, a project page) the draft starts from the
 * saved default and may override it for its first turn.
 *
 * The mode is the one setting whose consequence lands on the person's machine,
 * so the dots carry an accent marker whenever it is anything but Ask: hidden in
 * a menu, it must still be visible from the row.
 */
export function ComposerMenu({ conversationId, draftPermission, dictate }: {
  conversationId: string | null
  draftPermission?: { value: PermissionMode; onChange: (value: PermissionMode) => void } | undefined
  dictate: { label: string; disabled: boolean; onSelect: () => void }
}) {
  const { conversations, settings, setConversationPermission } = useWorkspace()
  const [open, setOpen] = useState(false)

  const conversation =
    conversationId === null
      ? undefined
      : conversations.find((candidate) => candidate.id === conversationId)
  const mode = findPermissionMode(conversation?.permissionMode ?? draftPermission?.value ?? settings.permission)
  const marked = mode.id !== 'ask'

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
      offset={COMPOSER.menuOffset}
      className="w-64"
      trigger={
        <IconButton
          label={marked ? `More options. Studio may: ${mode.name}` : 'More options'}
          size="xs"
          active={open}
          onClick={() => setOpen(!open)}
        >
          <Icons.dots size="md" />
          {marked ? (
            <span data-mode-marker aria-hidden className="absolute right-0.5 top-0.5 size-1.5 rounded-full bg-accent" />
          ) : null}
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
      <MenuSeparator />
      <MenuItem
        icon={<Icons.dictate />}
        disabled={dictate.disabled}
        onSelect={() => {
          setOpen(false)
          dictate.onSelect()
        }}
      >
        {dictate.label}
      </MenuItem>
    </Popover>
  )
}
