import { useState } from 'react'
import { Icons } from '@/components/icons'
import { IconButton, MenuItem, MenuLabel, MenuSeparator, Popover } from '@/components/primitives'

/**
 * The plus menu: what to give the turn beyond the words.
 *
 * Two groups, because they answer different questions. The first adds context
 * -- files, folders, an image. The second changes how the turn runs: a goal
 * survives the whole conversation, and plan mode makes the model propose before
 * it acts. Flattening them into one list would put "attach a file" beside
 * "change how the agent behaves", which are not peers.
 *
 * Dictation lives here rather than as a second glyph in the field. It is a way
 * of entering text, so it belongs with the other ways of adding to the turn --
 * and it keeps the resting field down to one control on each side.
 */
export function AddMenu() {
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
      className="min-w-56"
      trigger={
        <IconButton
          label="Add context"
          size="lg"
          active={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icons.add size="md" />
        </IconButton>
      }
    >
      <MenuLabel>Add</MenuLabel>
      <MenuItem icon={<Icons.attach />} onSelect={pick()}>
        Files
      </MenuItem>
      <MenuItem icon={<Icons.project />} onSelect={pick()}>
        Folder
      </MenuItem>
      <MenuItem icon={<Icons.image />} onSelect={pick()}>
        Image
      </MenuItem>

      <MenuSeparator />
      <MenuLabel>Mode</MenuLabel>
      <MenuItem icon={<Icons.goal />} note="A standing aim for the whole conversation." onSelect={pick()}>
        Set a goal
      </MenuItem>
      <MenuItem icon={<Icons.plan />} note="Propose the steps before touching anything." onSelect={pick()}>
        Plan first
      </MenuItem>

      <MenuSeparator />
      <MenuItem icon={<Icons.mcp />} onSelect={pick()}>
        Extensions
      </MenuItem>
    </Popover>
  )
}
