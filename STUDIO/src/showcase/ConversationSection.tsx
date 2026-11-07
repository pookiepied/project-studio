import { useEffect, useState } from 'react'
import { Button } from '@/components/primitives'
import { LiveUserMessage } from '@/features/chat/transcript/live/LiveUserMessage'
import { StreamedMarkdown } from '@/features/chat/streaming'
import { ApprovalPrompt } from '@/features/chat/permissions/ApprovalPrompt'
import { QuestionPrompt } from '@/features/chat/questions/QuestionPrompt'
import { QuoteStrip } from '@/features/chat/composer/QuoteStrip'
import { QuestionAnswers } from '@/features/chat/transcript/live/QuestionAnswers'
import { present } from '@/platform/harness/contracts/chunks'
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
    <div className="studio-content-column flex flex-col gap-8">
      <LiveUserMessage item={{ kind: 'user', id: 'specimen-user', submissionId: null, text: ASK, attachments: [], documents: [], timestamp: null }} />
      <div className="studio-prose"><StreamedMarkdown text={ANSWER.slice(0, characters) + (streaming ? '' : CITATIONS)} streaming={streaming} /></div>
      <Button variant="secondary" onClick={() => setCharacters(0)}>Replay streamed answer</Button>
    </div>
  </Section>
}

const noAnswer = async () => undefined

type QuestionRow = Parameters<typeof QuestionPrompt>[0]['rows'][number]

const CALL: readonly QuestionRow[] = [
  { id: 'q1', conversationId: 'c', createdAt: 1, expiresAt: null, payload: {
    question: 'Which UI elements build trust in AI responses?', header: 'Trust signals', multiSelect: false, recommendedOptionId: 'sources',
    options: [
      { id: 'sources', label: 'Cited sources (Recommended)', description: 'Each claim links to where it came from, so a reader can check it without asking.' },
      { id: 'uncertainty', label: 'Shown uncertainty', description: 'Say how sure the answer is.' },
      { id: 'steps', label: 'Visible steps', description: 'Show the work behind the result: the searches, the reads and the reasoning that led to it, in order, so a reviewer can follow the path the answer took.' },
    ] } },
  { id: 'q2', conversationId: 'c', createdAt: 2, expiresAt: null, payload: {
    question: 'Which platforms should the first release cover?', header: 'Platforms', multiSelect: true, recommendedOptionId: null,
    options: [
      { id: 'win', label: 'Windows', description: 'The desktop build we test daily.' },
      { id: 'mac', label: 'macOS', description: 'Needs signing and notarisation.' },
    ] } },
  { id: 'q3', conversationId: 'c', createdAt: 3, expiresAt: Date.now() + 9 * 60_000, payload: {
    question: 'How should the first screen greet a new user?', header: 'Onboarding', multiSelect: false, recommendedOptionId: null,
    options: [
      { id: 'blank', label: 'A blank composer', description: 'Nothing to read before the first message.' },
      { id: 'tour', label: 'A short tour', description: 'Three cards, skippable.' },
      { id: 'examples', label: 'Example prompts', description: 'Four starting points under the composer.' },
      { id: 'import', label: 'Import from another app', description: 'Bring conversations across first.' },
    ] } },
]

/** The record a settled call leaves in the transcript, as the real renderer draws it. */
const ANSWERED = {
  toolCallId: 'answered', toolName: 'ask_user_question', errorText: null,
  input: present({ questions: CALL.map((row) => ({ header: row.payload.header, question: row.payload.question })) }),
  output: present({ questions: [
    { header: 'Trust signals', outcome: 'answered', labels: ['Cited sources (Recommended)'] },
    { header: 'Platforms', outcome: 'answered', text: 'Windows first, then macOS once signing is sorted.\nLinux can wait.' },
    { header: 'Onboarding', outcome: 'deferred' },
  ] }),
}

/** The two cards a stopped run is answered through, on the real shell. */
export function PromptCardsSection() {
  const [rows, setRows] = useState<readonly QuestionRow[]>(CALL)
  const answer = async (id: string) => {
    await new Promise((resolve) => setTimeout(resolve, 150))
    setRows((current) => current.filter((row) => row.id !== id))
  }
  return <Section title="Questions and permissions" note="The card that stands in the composer's place while a run waits. Answer, skip or write to step through the call; the height eases between questions.">
    <div className="studio-content-column flex flex-col gap-6 pb-4">
      <div className="studio-composer">
        <QuoteStrip quote="Progressive rendering, so a visual can appear while the answer streams, as the compiler does, with a passage long enough to run past the cross." onRemove={() => {}} />
        <p className="px-1 pb-2 text-muted-foreground">Reply</p>
      </div>
      {rows.length > 0 ? (
        <QuestionPrompt rows={rows} answeringId={null} onAnswer={answer} onStop={() => setRows([])} />
      ) : (
        <Button variant="secondary" onClick={() => setRows(CALL)}>Ask the three questions again</Button>
      )}
      <ApprovalPrompt
        questions={[{ id: 'a1', createdAt: 1, agentId: null, lastingScopeId: 'folder',
          sentence: [{ kind: 'text', text: 'Write ' }, { kind: 'code', text: 'src/app.ts' }, { kind: 'text', text: " in this conversation's workspace." }],
          reason: null, maxDuration: 'always' }]}
        answeringId={null} onAnswer={noAnswer} hasProject onStop={() => {}}
      />
      <p className="text-caption text-muted-foreground">In the transcript, once answered:</p>
      <QuestionAnswers call={ANSWERED} />
    </div>
  </Section>
}
