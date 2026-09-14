import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/**
 * The conversation's wait enters, and its dots bob.
 *
 * The wait (`TranscriptWait`) is the child an `AnimatePresence` is BORN
 * with: the phase machine opens in `attaching`, so on the conversation
 * page's very first render the wait is already there. An `AnimatePresence
 * initial={false}` tells such a child that its entrance is already over,
 * which blocks the initial animation of the whole subtree - the wait
 * snapped in at full opacity and the dots stood at their rest pose, silent
 * through every later render, because a re-render hands Framer the same
 * keyframes it mounted with and it declines to start what looks finished.
 * That stood for three commits' worth of "the dots never move" - the em
 * fix was real but nobody had met it, because the block got there first.
 *
 * Like the page-outlet guard, this is caught by no failing render: the
 * page still draws, the dots still show. Only a reader of the source, or
 * this test, meets the difference. The element must therefore appear in
 * its bare form, directly joined to the condition that mounts the wait -
 * a prop on the tag, or anything mounted between them, breaks the pairing
 * this watches for.
 */
const CHAT_PAGE = fileURLToPath(new URL('../src/features/chat/ChatPage.tsx', import.meta.url))

describe('the conversation wait in ChatPage', () => {
  const source = readFileSync(CHAT_PAGE, 'utf8')

  it('mounts the wait under a presence with no initial={false}', () => {
    // Prose in the comments names `initial={false}` at length to explain
    // the rule; only JSX outside a comment is the mistake. Strip comments
    // first, the way the outlet guard does.
    const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code).toMatch(/<AnimatePresence>\s*\{!revealed/)
  })
})
