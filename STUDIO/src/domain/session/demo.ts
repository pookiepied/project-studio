import { galleryConversation } from '@/domain/session/gallery'
import { longThread } from '@/domain/session/longThread'
import { newId } from '@/lib/id'
import type { Conversation, Message } from '@/domain/session/types'
import type { Project } from '@/domain/projects/types'

/**
 * Demo content.
 *
 * Everything fake in the app is in this file. Nothing else imports it except
 * the two seed calls and the one reply call in `SessionProvider`, so removing
 * the demo is deleting this module and fixing three import errors.
 *
 * The canned reply deliberately exercises every renderer the transcript has —
 * headings, lists, a table, inline and fenced code, math, and a rule — because
 * a demo that only emits plain paragraphs proves nothing about the layout that
 * has to survive real output.
 */

const HOUR = 60 * 60 * 1000

export const DEMO_PROJECTS: readonly Project[] = [
  {
    id: 'prj_quiet',
    name: 'Quiet Hours',
    icon: 'arc',
    description: 'The reading and typography work.',
    folders: [
      { id: 'src_1', name: 'quiet-hours', path: 'D:/Work/quiet-hours' },
      { id: 'src_2', name: 'design-notes', path: 'D:/Work/quiet-hours/design-notes' },
    ],
    branch: 'main',
    branches: ['main', 'type-scale', 'composer-pill'],
    createdAt: Date.now() - 40 * 24 * HOUR,
  },
  {
    id: 'prj_harness',
    name: 'Harness',
    icon: 'stack',
    description: 'Runtime, permissions, sandboxing.',
    folders: [{ id: 'src_3', name: 'studio-harness', path: 'D:/Work/studio-harness' }],
    branch: 'permissions/scope-ids',
    branches: ['main', 'permissions/scope-ids', 'mcp/capabilities'],
    createdAt: Date.now() - 90 * 24 * HOUR,
  },
]

function message(role: Message['role'], text: string, extra: Partial<Message> = {}): Message {
  return { id: newId('msg'), role, text, createdAt: Date.now(), ...extra }
}

export const DEMO_CONVERSATIONS: readonly Conversation[] = [
  // First and pinned. It is the fixture every renderer is judged against, and
  // one you have to go looking for is one nobody looks at.
  galleryConversation(),
  // Three hundred and twenty messages, so the batching is reachable.
  longThread(),
  {
    id: 'cnv_render',
    title: 'What the transcript can render',
    projectId: 'prj_quiet',
    updatedAt: Date.now() - 20 * 60 * 1000,
    pinned: false,
    archived: false,
    messages: [
      message('user', 'Show me everything the transcript can render.'),
      message('assistant', richSample(), {
        modelId: 'opus-5',
        thinking: {
          text: 'The answer should be the renderers themselves rather than a description of them.\n\nHeadings, a list, a table, a fence and some math -- those are the four blocks most likely to break a narrow column, so they are the ones worth showing.',
          seconds: 6,
        },
      }),
    ],
  },
  {
    id: 'cnv_measure',
    title: 'Reading measure for the transcript',
    projectId: 'prj_quiet',
    updatedAt: Date.now() - 2 * HOUR,
    pinned: true,
    archived: false,
    messages: [
      message('user', 'What measure should the transcript use? It runs full width and it is tiring to read.'),
      message(
        'assistant',
        [
          'Cap it near 70 to 80 characters. At 14px that lands around **44rem**, which is what the shell uses now.',
          '',
          'The reason is the return sweep: past about 80 characters the eye loses the line it came from on the way back, and you re-read the same row.',
        ].join('\n'),
        { modelId: 'sonnet-5', thinking: { text: 'The question is about line length, not font size. Anchor on the return sweep rather than on aesthetics.', seconds: 4 } },
      ),
    ],
  },
  {
    id: 'cnv_corners',
    title: 'Why the corners looked wrong',
    projectId: 'prj_quiet',
    updatedAt: Date.now() - 26 * HOUR,
    pinned: false,
    archived: false,
    messages: [
      message('user', 'The rounded panel inside the rounded window looks pasted on. What is the rule?'),
      message(
        'assistant',
        'Concentric radii. A container of radius `R` with padding `P` holds children of radius `R - P`.\n\nIf the inner radius is larger, its arc bulges past the outer one and the two curves cross, which is the specific thing that reads as pasted on.',
        { modelId: 'opus-5' },
      ),
    ],
  },
  {
    id: 'cnv_scopes',
    title: 'Naming the permission modes',
    projectId: 'prj_harness',
    updatedAt: Date.now() - 3 * 24 * HOUR,
    pinned: false,
    archived: false,
    messages: [
      message('user', 'Are "auto-approve" and "manual" good labels for the execution modes?'),
      message(
        'assistant',
        'They name the mechanism rather than the consequence, so they only make sense once you already know how the system works.\n\nWrite the sentence someone reads at the moment they choose. "Ask before everything" and "Proceed unless a rule says ask" describe what happens to their machine.',
        { modelId: 'opus-5' },
      ),
    ],
  },
  {
    id: 'cnv_loose',
    title: 'Scrollbar behaviour under a fade',
    projectId: null,
    updatedAt: Date.now() - 5 * 24 * HOUR,
    pinned: false,
    archived: false,
    messages: [
      message('user', 'The scroll thumb disappears into the gradient at the top and bottom.'),
      message(
        'assistant',
        'Inset the track. The thumb stops short of both fades while the content still scrolls its full range -- only the indicator gets shorter, not the reach.',
        { modelId: 'haiku-4-5' },
      ),
    ],
  },
  {
    id: 'cnv_archived',
    title: 'Old icon audit',
    projectId: null,
    updatedAt: Date.now() - 30 * 24 * HOUR,
    pinned: false,
    archived: true,
    messages: [
      message('user', 'Which glyphs are doing double duty?'),
      message('assistant', 'The brain was carrying both "thinking now" and "how hard to think". Those are different questions and now hold different marks.', { modelId: 'sonnet-5' }),
    ],
  },
]

/** The reasoning trace shown while a demo turn is in flight. */
export function demoThinking(): string {
  return [
    'Reading the request and deciding which renderer each part of the answer needs.',
    'The reply should exercise headings, a list, a table, fenced code and math, because those are the paths most likely to break the column.',
    'Keeping the prose short so the structure is what shows.',
  ].join('\n\n')
}

/**
 * The canned reply.
 *
 * It does not vary with the prompt on purpose. A demo that pretends to
 * understand invites judging the model instead of the interface, and the
 * interface is the only thing here that is real.
 *
 * The same text is seeded into a finished conversation above, so the renderers
 * are visible the moment Studio opens rather than only after waiting out a
 * stream.
 */
export function demoReply(): string {
  return richSample()
}

function richSample(): string {
  return `There is no runtime behind this build yet, so this reply is fixed. It streams at the cadence a real one will, into the same column.

## What it is exercising

Every renderer the transcript owns, because a demo of plain paragraphs proves nothing about the layout that has to survive real output.

- Headings and lists, for vertical rhythm
- A table, which must scroll inside itself rather than widen the column
- Fenced code, wrapped or not at your choice
- Inline math like $E = mc^2$, and a display block below

| Surface | Radius | Derived from |
| --- | --- | --- |
| Window | 20px | chosen |
| Panel | 12px | window minus padding |
| Menu row | 8px | panel minus padding |

The concentric rule, written out:

$$
r_{\\text{inner}} = r_{\\text{outer}} - p
$$

\`\`\`ts
// The one place a mark is bound to a concept.
export const REGISTRY = {
  thinking: sparkle,   // a live event
  reasoning: gauge,    // a setting, a level
  permission: shield,  // a setting, a consequence
} satisfies Record<string, Glyph>
\`\`\`

Replacing this is one function. \`SessionProvider\` calls \`demoReply\` in exactly one place.`
}
