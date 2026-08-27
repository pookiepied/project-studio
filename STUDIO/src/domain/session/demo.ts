/**
 * Demo content.
 *
 * What remains of the demo is what still has a caller: the canned reply and
 * thinking trace the artifact gallery replays (`useDemoTurn`). The seeded
 * conversations and projects went with Task 37 - the harness owns the index -
 * and the demo model catalog went with Task 38, because a picker showing six
 * models that do not exist is worse than one that says the harness cannot be
 * reached. The canned reply deliberately exercises every renderer the
 * transcript has, so a display of stages still proves something about layout.
 */

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
