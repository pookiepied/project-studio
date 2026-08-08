import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { markdownComponents } from '@/features/chat/transcript/markdown/markdownComponents'

/**
 * Assistant prose.
 *
 * `remark-gfm` for tables, strikethrough, task lists and autolinks — the
 * dialect models actually write. Element behaviour lives in
 * `markdownComponents`; typography lives in `.studio-prose`.
 *
 * The width discipline is the point: `min-w-0` here is what lets the code and
 * table containers inside actually scroll instead of stretching the transcript.
 */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="studio-prose min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
