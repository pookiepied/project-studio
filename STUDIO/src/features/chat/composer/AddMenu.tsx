import { useState } from 'react'
import { COMPOSER } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton, MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/primitives'

/**
 * The plus menu: what to give the turn beyond the words.
 *
 * Two groups, because they answer different questions. The first adds
 * context; the second changes how the turn runs: a goal survives the whole
 * conversation, and plan mode makes the model propose before it acts.
 * Flattening them into one list would put "attach a file" beside "change how
 * the agent behaves", which are not peers.
 *
 * Adding context is one item. It was three - Files, Folder, Image - and the
 * three were the implementation's view: what the harness could carry today
 * (images) and what it would carry later (the rest). A person attaching
 * something does not sort it by our roadmap first; they pick a thing and the
 * picker says what it can take. So the one item opens the one picker, and
 * what the picker refuses it names, in the composer, by file.
 *
 * Each row has one short line under it, and every row has one. The lines
 * were once sentences - "Seen by the model this turn and every turn after" -
 * and a menu of four verbs read like a page of prose. They were then removed
 * altogether, which left "Set a goal" and "Plan first" as bare phrases a new
 * person has to guess at. A few words is the size that says what the row
 * does without asking to be read: the same length on every row, so none of
 * them looks like the important one.
 *
 * The panel opens off the composer's box, not off the paperclip, so the gap
 * outside the box is the same on every menu that opens from its tools.
 */
export function AddMenu({ onAttach }: { onAttach?: () => void }) {
  const [open, setOpen] = useState(false)

  const pick = (run?: () => void) => () => {
    setOpen(false)
    run?.()
  }

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      side="top"
      align="start"
      offset={COMPOSER.menuOffset}
      className="min-w-56"
      trigger={
        <IconButton
          label="Add context"
          size="xs"
          active={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icons.paperclip size="md" />
        </IconButton>
      }
    >
      <MenuLabel>Add</MenuLabel>
      <MenuItem icon={<Icons.attach />} note="Shared with the model" onSelect={pick(onAttach)}>
        Files
      </MenuItem>

      <MenuSeparator />
      <MenuLabel>Mode</MenuLabel>
      <MenuItem icon={<Icons.goal />} note="For the whole conversation" onSelect={pick()}>
        Set a goal
      </MenuItem>
      <MenuItem icon={<Icons.plan />} note="Steps before any change" onSelect={pick()}>
        Plan first
      </MenuItem>

      <MenuSeparator />
      <MenuItem icon={<Icons.mcp />} note="Connected tools" onSelect={pick()}>
        Extensions
      </MenuItem>
    </Popover>
  )
}
