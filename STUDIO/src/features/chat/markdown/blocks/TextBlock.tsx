import { useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { DURATION } from '@/design/tokens'
import { Icons } from '@/components/icons'
import { IconButton } from '@/components/primitives'
import { copyText } from '@/lib/clipboard'
import { BlockFrame } from '@/features/chat/markdown/blocks/BlockFrame'

/** The preview cap, in px. Roughly a dozen lines of prose. */
const PREVIEW_HEIGHT = 260

const COPIED_MS = 2000

/**
 * Prose the model produced *as an object* rather than as part of its answer.
 *
 * Ask for a paragraph to be rewritten and the reply contains two different
 * kinds of text: the explanation, which is the model talking to you, and the
 * rewrite, which is a thing you are meant to take away and use. Running them
 * together as one column of prose is the reason people end up hunting for
 * where the actual draft starts and stops -- and then select it by hand and
 * get the sentence before it as well.
 *
 * So a draft gets the same treatment code gets: a frame, a name, a copy
 * button, and an edge. It is the identical `BlockFrame` deliberately, because
 * "here is a thing you can take" is one idea and should look like one.
 *
 * Where code is monospaced and unwrapped, this is body text at reading measure
 * -- the point is to judge how it *reads*, so it has to be set the way it will
 * eventually be read.
 */

/** Fence names that mean "this is a piece of writing", mapped to their label. */
export const TEXT_FENCES: Readonly<Record<string, string>> = {
  text: 'Text',
  draft: 'Draft',
  rewrite: 'Rewrite',
  prose: 'Text',
  quote: 'Quote',
}

export function TextBlock({ text, fence }: { text: string; fence: string }) {
  const [copied, setCopied] = useState(false)

  const words = text.trim().split(/\s+/).filter(Boolean).length

  const copy = async () => {
    if (!(await copyText(text))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), COPIED_MS)
  }

  return (
    <BlockFrame
      label={TEXT_FENCES[fence] ?? 'Text'}
      meta={`${words} ${words === 1 ? 'word' : 'words'}`}
      previewHeight={PREVIEW_HEIGHT}
      actions={
        <IconButton label={copied ? 'Copied' : 'Copy text'} size="sm" onClick={() => void copy()}>
          <AnimatePresence mode="wait" initial={false}>
            <motion.span
              key={copied ? 'copied' : 'copy'}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: DURATION.fast }}
              className="flex items-center"
            >
              {copied ? <Icons.check /> : <Icons.copy />}
            </motion.span>
          </AnimatePresence>
        </IconButton>
      }
    >
      {/* `whitespace-pre-wrap`, not markdown. A draft is literal: if the model
          wrote an asterisk, the asterisk is part of the text you asked for and
          rendering it as emphasis would hand back something you cannot paste. */}
      <p className="studio-selectable px-4 text-body whitespace-pre-wrap text-foreground">
        {text}
      </p>
    </BlockFrame>
  )
}
