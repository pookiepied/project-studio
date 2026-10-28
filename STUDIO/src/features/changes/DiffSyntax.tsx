import { SyntaxHighlighter } from '@/features/chat/markdown/highlighter'

/** Inline tokens retain the diff's own signs, gutters and theme colors. */
export function DiffSyntax({ text, language }: { text: string; language: string }) {
  return <SyntaxHighlighter language={language} useInlineStyles={false} PreTag="span" CodeTag="span" className="studio-code" customStyle={{ display: 'inline', background: 'transparent', padding: 0 }}>{text || ' '}</SyntaxHighlighter>
}
