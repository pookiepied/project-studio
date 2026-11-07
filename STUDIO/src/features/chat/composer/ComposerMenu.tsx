import { useState } from 'react'
import { COMPOSER } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton, MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from '@/components/primitives'
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
 *
 * Dictate is always "Dictate". Where the microphone cannot be asked for (an
 * insecure origin), the row greys and says "Not available" at its end, with
 * the reason on hover: the reason is a sentence and the menu is a list of
 * words, so it used to wrap the row into a paragraph.
 */
export function ComposerMenu({ conversationId, draftPermission, dictate }: {
  conversationId: string | null
  draftPermission?: { value: PermissionMode; onChange: (value: PermissionMode) => void } | undefined
  dictate: {
    disabled: boolean
    /** Why dictation cannot be used here at all, or null where it can. */
    unavailable: string | null
    onSelect: () => void
  }
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
      {dictate.unavailable !== null ? (
        <Tooltip label={dictate.unavailable} explainOnTap className="block">
          <MenuItem
            icon={<Icons.dictate />}
            hint="Not available"
            label={`Dictate. ${dictate.unavailable}`}
            disabled
            onSelect={() => {}}
          >
            Dictate
          </MenuItem>
        </Tooltip>
      ) : (
        <MenuItem
          icon={<Icons.dictate />}
          disabled={dictate.disabled}
          onSelect={() => {
            setOpen(false)
            dictate.onSelect()
          }}
        >
          Dictate
        </MenuItem>
      )}
    </Popover>
  )
}
