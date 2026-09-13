import { useState } from 'react'
import { MenuItem, MenuLabel, Popover, Tooltip } from '@/components/primitives'
import { PERMISSION_MODES, findPermissionMode, type PermissionMode } from '@/domain/permissions/modes'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

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
  const Mark = mode.icon
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
        <Tooltip label={`What Studio may do · ${mode.name}`}>
          <button
            type="button"
            onClick={() => setOpen(!open)}
            aria-label={`What Studio may do: ${mode.name}`}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-full px-2 text-ui',
              // Matches the other controls in the row, so the field's contents
              // sit on one line rather than one of them being a different
              // height and pulling the row's centre off.
              // The control step, not `h-8`. This sits in the composer's row
              // beside three icon buttons, and as a rem class it was the one
              // that did not move with them — 32 against their 28, which set
              // the whole field's height and made the capsule 4px taller than
              // its own tokens said it was.
              'h-[var(--control-md)] transition-colors duration-fast',
              // Every mode is now a mark and nothing else — the three used to
              // disagree, with `auto` alone also spelling its name, so the
              // control changed width when you changed mode and the row
              // reflowed around it.
              //
              // The reason `auto` spelled itself is still real: it is the one
              // mode where sending means the app proceeds without asking, and
              // a glyph can be glanced past. So the signal stays and only the
              // text goes — unattended is the one state that paints itself,
              // which reads at the edge of vision the way a word never did,
              // and costs no width.
              loud ? 'text-foreground' : 'text-muted-foreground',
              open ? 'bg-selected' : loud ? 'bg-tint hover:bg-selected' : 'hover:bg-tint',
            )}
          >
            <Mark className="shrink-0" />
          </button>
        </Tooltip>
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
