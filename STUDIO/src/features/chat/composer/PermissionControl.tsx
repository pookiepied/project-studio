import { useState } from 'react'
import { MenuItem, MenuLabel, Popover, Tooltip } from '@/components/primitives'
import { PERMISSION_MODES, findPermissionMode } from '@/domain/permissions/modes'
import { useWorkspace } from '@/stores/workspace'
import { cn } from '@/lib/cn'

/**
 * What Studio may do, in the composer.
 *
 * ---- Why it left the turn menu --------------------------------------------
 *
 * Model, reasoning and permission were one menu because they are all "what
 * happens when I press send". True, and it hid the difference that matters:
 * they are touched at completely different rates. The model is a per-
 * conversation choice, reasoning is a per-question dial, and permission is a
 * per-*situation* consent — the only one of the three whose consequence lands
 * on the user's files. It is also the one you reconsider while looking at the
 * thing you are about to send, which is not where the window chrome is.
 *
 * So it sits by the send button. That leaves the pill in the strip meaning one
 * coherent thing — who you are talking to and how hard it is thinking — and
 * puts the consent where the consequence happens.
 *
 * ---- Why it is a mark and not a label -------------------------------------
 *
 * The brief is fewer things to look at by default, and a permanent word in the
 * composer is a word to read every time the eye passes the field. Three modes
 * reuse three glyphs, so the mark becomes recognisable the way a transport
 * control is — and unlike a label, it costs no width that the text should be
 * spending. The name is one hover away, and the full sentence is one click.
 *
 * The exception is the mode that changes what "send" means most: `auto` also
 * shows its name. Running unattended is the one state worth being unable to
 * forget you are in, and a mark alone can be glanced past.
 */
export function PermissionControl() {
  const { settings, setSettings } = useWorkspace()
  const [open, setOpen] = useState(false)

  const mode = findPermissionMode(settings.permission)
  const Mark = mode.icon
  const loud = mode.id === 'auto'

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
          selected={candidate.id === settings.permission}
          note={candidate.note}
          onSelect={() => {
            setSettings({ ...settings, permission: candidate.id })
            setOpen(false)
          }}
        >
          {candidate.name}
        </MenuItem>
      ))}
    </Popover>
  )
}
