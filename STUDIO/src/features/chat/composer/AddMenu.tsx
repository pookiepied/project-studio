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
 * The rows are their labels, with no second line. Each verb here is one a
 * person already knows - attach files, set a goal, plan first, extensions -
 * and a sentence under it explaining what it means read as the menu
 * doubting its own words. Explanation belongs where the thing happens, if
 * it is needed at all.
 *
 * The panel opens off the capsule, not off the plus. The button sits inside
 * the capsule's padding, and a panel placed against the button's edge sat on
 * the capsule's border. The distance is the padding twice over: once to
 * reach the capsule's edge, and the same again above it, so the gap outside
 * the capsule is the gap the button has inside it.
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
      offset={COMPOSER.paddingBlock * 2}
      className="min-w-56"
      trigger={
        <IconButton
          label="Add context"
          size="md"
          active={open}
          onClick={() => setOpen((value) => !value)}
        >
          <Icons.add size="md" />
        </IconButton>
      }
    >
      <MenuLabel>Add</MenuLabel>
      <MenuItem icon={<Icons.attach />} onSelect={pick(onAttach)}>
        Files
      </MenuItem>

      <MenuSeparator />
      <MenuLabel>Mode</MenuLabel>
      <MenuItem icon={<Icons.goal />} onSelect={pick()}>
        Set a goal
      </MenuItem>
      <MenuItem icon={<Icons.plan />} onSelect={pick()}>
        Plan first
      </MenuItem>

      <MenuSeparator />
      <MenuItem icon={<Icons.mcp />} onSelect={pick()}>
        Extensions
      </MenuItem>
    </Popover>
  )
}
