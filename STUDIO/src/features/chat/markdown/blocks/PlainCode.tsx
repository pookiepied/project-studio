import { BODY, CODE, LINE_NUMBER } from '@/features/chat/markdown/blocks/codeStyle'

/**
 * A code block's lines, uncoloured, in the place the coloured ones will take.
 * What `CodeBlock` shows while the highlighter's chunk arrives - see
 * `codeStyle.ts` for why the two renderings share their geometry.
 */
export function PlainCode({ code }: { code: string }) {
  const lines = code.replace(/\n$/, '').split('\n')
  return (
    <pre className="studio-code" style={BODY}>
      <code style={CODE}>
        {lines.map((line, index) => (
          <span key={index}>
            <span style={LINE_NUMBER}>{index + 1}</span>
            {line}
            {'\n'}
          </span>
        ))}
      </code>
    </pre>
  )
}
