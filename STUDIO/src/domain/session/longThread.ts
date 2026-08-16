import type { Conversation, Message } from '@/domain/session/types'

/**
 * A conversation long enough to page.
 *
 * The batching in `useTranscriptWindow` is invisible until a transcript exceeds
 * what fits in one window, and every other demo conversation is four turns. A
 * feature that cannot be reached from the running app is a feature nobody
 * checks, so this generates a few hundred turns of plausible back-and-forth.
 *
 * Generated rather than written out: three hundred hand-authored messages would
 * be a file nobody reads and a diff nobody reviews, and the point here is the
 * *shape* of a long history, not its content.
 */

const QUESTIONS = [
  'Why does the composer reshape when I paste?',
  'Can you explain the scroll follow again?',
  'What happens if the fence never closes?',
  'Is the context meter derived or stored?',
  'How do artifacts survive an unknown kind?',
  'Why is the sidebar collapsed by default?',
  'What decides when the rail can grow?',
  'Where does the reveal rate come from?',
]

const ANSWERS = [
  'Because the radius was interpolating from 9999px, so it read as a capsule for most of the transition and collapsed near the end. A finite resting radius fixed it.',
  'The viewport is driven toward the bottom rather than assigned to it, closing a proportion of the gap each frame. Text reflows by whole lines, so assignment reproduced that staircase exactly.',
  'The segmenter closes it, so the block is a code block from its first character and only grows downward. Otherwise the lines render as prose and become a framed panel later, shoving everything below.',
  'Derived. Stored, it could disagree with the messages it described, and it only ever went up -- fork or edit and it kept climbing.',
  'Every artifact may carry generic sections, and an unknown kind is drawn entirely from them. A dedicated renderer is an upgrade, never a prerequisite.',
  'Closed, the window is the conversation and nothing else, which is the point of the app. The toggle, the palette and the shortcut all bring it back.',
  'The room available, not a constant. The page keeps a floor and the rail gets what is left; with no room to spare the drag refuses.',
  'It is measured off the stream. A fixed rate is wrong in both directions -- too slow and a fast model runs thousands of characters behind, too fast and a slow one reveals its buffer in a burst.',
]

/** Enough to need several batches at any plausible window height. */
const TURNS = 160

export const LONG_THREAD_ID = 'cnv_long'

export function longThread(): Conversation {
  const messages: Message[] = []
  const start = Date.now() - TURNS * 4 * 60 * 1000

  for (let turn = 0; turn < TURNS; turn += 1) {
    const at = start + turn * 4 * 60 * 1000
    messages.push({
      id: `long_u_${turn}`,
      role: 'user',
      text: `${turn + 1}. ${QUESTIONS[turn % QUESTIONS.length]}`,
      createdAt: at,
    })
    messages.push({
      id: `long_a_${turn}`,
      role: 'assistant',
      text: ANSWERS[turn % ANSWERS.length],
      modelId: 'sonnet-5',
      createdAt: at + 30_000,
    })
  }

  return {
    id: LONG_THREAD_ID,
    title: 'A long history',
    projectId: 'prj_quiet',
    pinned: false,
    archived: false,
    updatedAt: Date.now() - 90 * 60 * 1000,
    messages,
  }
}
