import { BODY, CODE, LINE_NUMBER } from '@/features/chat/markdown/blocks/codeStyle'
import { SyntaxHighlighter } from '@/features/chat/markdown/highlighter'

/**
 * The body of a code block: the code, coloured.
 *
 * Its own module because it is the one thing in the transcript that carries
 * the highlighter and twenty grammars, and `CodeBlock` imports it lazily,
 * showing `PlainCode` in the same geometry until it lands.
 */
export function HighlightedCode({ code, language }: { code: string; language: string }) {
  // `useInlineStyles={false}` is the whole theme decision. The highlighter
  // emits `hljs-*` class names and the palette lives in `styles/prose.css`
  // next to the tokens, so it follows the theme with no prop, no re-render
  // and no imported colour object. The container's own radius and overflow
  // clip the corners, so the highlighter paints none of its own. Line
  // numbers ride the highlighter's own gutter - it is the only renderer that
  // can number the lines the tokens actually land on - and the numbers are
  // unselectable, so a hand-dragged selection copies code, not a column of
  // digits. The copy button copies the raw text either way.
  return (
    <SyntaxHighlighter
      language={language}
      useInlineStyles={false}
      showLineNumbers
      lineNumberStyle={LINE_NUMBER}
      className="studio-code"
      customStyle={BODY}
      codeTagProps={{ style: CODE }}
    >
      {code}
    </SyntaxHighlighter>
  )
}
