import { Icons } from '@/components/icons'
import { FormatGlyph, Mark, formatOfName, markOfName } from '@/components/icons/fileTypes'
import { CopyButton } from '@/components/primitives'
import { BlockFrame } from '@/features/chat/markdown/blocks/BlockFrame'
import { SyntaxHighlighter, displayName, resolveLanguage } from '@/features/chat/markdown/languages'

/**
 * A code block's glyph is the language's own mark -- the same marks the tool
 * chips carry -- keyed on the fence's own word, because a fence names a
 * language, not a file; going through the highlighter's resolution would
 * lose every language it does not parse and mark plain `java` as unknown.
 * Brand-less formats (SQL, XML, YAML) take their concept's registry icon;
 * languages with neither (SQL's neighbours diff, TOML aside) fall to the
 * coding mark, which is the honest "code, kind unspecified".
 */
function Glyph({ fence }: { fence: string }) {
  const mark = markOfName(fence)
  if (mark !== null) return <Mark mark={mark} className="shrink-0 text-muted-foreground" />
  const format = formatOfName(fence)
  if (format !== null) {
    return <FormatGlyph format={format} size="sm" className="shrink-0 text-muted-foreground" />
  }
  return <Icons.coding size="sm" className="shrink-0 text-muted-foreground" />
}

/**
 * Lines of text in a block, with a closing newline read as a terminator
 * rather than as an empty last line -- the same rule the diff builder's own
 * splitter follows, and the reason a four-line fence no longer says five.
 */
function countLines(code: string): number {
  if (code === '') return 0
  const parts = code.split('\n')
  if (parts[parts.length - 1] === '') parts.pop()
  return parts.length
}

/**
 * Fenced code, in the artifact container, shown in full.
 *
 * ---- The containment problem ---------------------------------------------
 *
 * A code block is the one piece of model output that can be arbitrarily wide,
 * and a wide `<pre>` stretches its parent rather than scrolling inside it. Once
 * that happens the transcript column widens and every message reflows — which
 * is the failure that makes code blocks look broken in most chat interfaces.
 * So the body scrolls both ways inside the frame's own cap, and `min-w-0` on
 * every flex ancestor up to the scroll container is what lets the frame hold
 * the column at all.
 *
 * Lines do not wrap. Wrapped code misreads structure -- a wrapped line looks
 * like two -- and this block is a working surface now, not a preview; the
 * horizontal scroller is the honest answer to a long line.
 */
export function CodeBlock({ code, fence }: { code: string; fence: string }) {
  // ```ts:src/utils/get-diff.ts — the language, then optionally where this came
  // from. A path makes a far better caption than a language name: "TypeScript"
  // is already obvious from the syntax colouring, while *which file* is the one
  // thing the block cannot tell you itself.
  const [language, ...rest] = fence.split(':')
  const path = rest.join(':') || undefined

  // A trailing newline closes the last line; it does not open an empty one.
  // Counting the split's parts called a four-line block five lines whenever
  // the fence's content ended in a break, which is most of the time.
  const lines = countLines(code)

  return (
    <BlockFrame
      glyph={<Glyph fence={language} />}
      label={path ?? displayName(language)}
      meta={lines === 1 ? '1 line' : `${lines} lines`}
      actions={
        <CopyButton text={code} label="Copy code" />
      }
    >
      {/* `useInlineStyles={false}` is the whole theme decision. The highlighter
          emits `hljs-*` class names and the palette lives in `index.css` next
          to the tokens, so it follows the theme with no prop, no re-render and
          no imported colour object. The container's own radius and overflow
          clip the corners, so the highlighter paints none of its own.
          Line numbers ride the highlighter's own gutter -- it is the only
          renderer that can number the lines the tokens actually land on -- and
          the numbers are unselectable, so a hand-dragged selection copies
          code, not a column of digits. The copy button copies the raw text
          either way. */}
      <SyntaxHighlighter
        language={resolveLanguage(language)}
        useInlineStyles={false}
        showLineNumbers
        lineNumberStyle={{
          display: 'inline-block',
          minWidth: '1.75rem',
          marginRight: '0.75rem',
          textAlign: 'right',
          color: 'var(--muted-foreground)',
          opacity: 0.65,
          userSelect: 'none',
        }}
        className="studio-code"
        customStyle={{
          margin: 0,
          // No top padding: the head above already separates the code from
          // everything else, and a second gap under the rule read as the code
          // starting late. The bottom keeps its own -- the last line must not
          // sit on the frame's edge or under the horizontal bar. The last
          // value is the code's left inset; the gutter sits closer to the
          // frame's edge than the code sits to the gutter, which is the
          // ordering an editor reads by.
          padding: '0 1.125rem 0.875rem 0.75rem',
          fontSize: 'var(--code-size)',
          lineHeight: 1.7,
          background: 'transparent',
        }}
        codeTagProps={{ style: { fontFamily: 'var(--font-mono)', fontWeight: 400 } }}
      >
        {code}
      </SyntaxHighlighter>
    </BlockFrame>
  )
}
