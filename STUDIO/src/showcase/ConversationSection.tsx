import { useEffect, useState } from 'react'
import { Button } from '@/components/primitives'
import { SHELL } from '@/design/tokens'
import { LiveUserMessage } from '@/features/chat/transcript/live/LiveUserMessage'
import { StreamedMarkdown } from '@/features/chat/streaming'
import { Section } from './Section'

const ASK = '# A clearer research brief\n\nCompare **readability**, *structure*, and useful details.\nKeep this second line.\n\n1. Explain the result.\n2. Include the caveats.\n\nUse `workspace/chart.png` as the example filename.'
const CITATIONS = '\n\nA numbered source stays compact beside its claim. [1](https://example.com/source "Supporting evidence")\n\nUse `count + 1` for an expression; file references keep the surrounding sentence typography.'
const ANSWER = 'The conversation should read like a carefully typeset document. **The result comes first**, followed by the detail needed to assess it.\n\n## What changed\n\nUser messages now preserve headings, **emphasis**, and lists. Assistant answers use the same reading size and a quiet hierarchy.\n\n1. **Inspect the result.**\n\n   Keep the explanation attached to its step, even while the answer streams.\n\n   - Check the chart labels.\n   - Compare the underlying values.\n\n2. **Record the limitation.** A filename such as `workspace/chart.png` still needs a file resolver to become a preview.\n\n### Evidence and limits\n\n| Area | Result |\n| --- | --- |\n| User messages | Headings, lists, emphasis, and code |\n| Streamed text | Nested structure stays together |\n\n> Formatting makes an answer easier to inspect. It does not establish that a task succeeded.\n\nRead [the supporting guide][guide] for the details.\n\n[guide]: https://example.com/guide'

export function ConversationSection() {
  const [characters, setCharacters] = useState(ANSWER.length)
  const streaming = characters < ANSWER.length
  useEffect(() => {
    if (!streaming) return
    const timer = window.setInterval(() => setCharacters((value) => Math.min(ANSWER.length, value + 18)), 35)
    return () => window.clearInterval(timer)
  }, [streaming])
  return <Section title="Conversation" note="Real user and answer renderers. Check hierarchy, wrapping, nested lists, and streaming in both themes.">
    <div className="flex min-w-0 flex-col gap-8 self-center w-full" style={{ maxWidth: SHELL.measure }}>
      <LiveUserMessage item={{ kind: 'user', id: 'specimen-user', submissionId: null, text: ASK, attachments: [], documents: [], timestamp: null }} />
      <div className="studio-prose"><StreamedMarkdown text={ANSWER.slice(0, characters) + (streaming ? '' : CITATIONS)} streaming={streaming} /></div>
      <Button variant="secondary" onClick={() => setCharacters(0)}>Replay streamed answer</Button>
    </div>
  </Section>
}
