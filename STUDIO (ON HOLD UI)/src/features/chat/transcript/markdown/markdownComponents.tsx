import type { Components } from 'react-markdown'
import { CodeBlock } from '@/features/chat/transcript/markdown/CodeBlock'
import { resolveLanguage } from '@/features/chat/transcript/markdown/languages'

/** Flattens a node's rendered children back to plain text. */
function textOf(node: React.ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string') return node
  if (typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (typeof node === 'object' && 'props' in node) {
    const element = node as React.ReactElement<{ children?: React.ReactNode }>
    return textOf(element.props.children)
  }
  return ''
}

/**
 * Element overrides for assistant markdown.
 *
 * Only elements needing behaviour or containment are overridden here; the rest
 * are styled by the `.studio-prose` contract in index.css, so this map stays
 * about structure rather than becoming a second stylesheet.
 */
export const markdownComponents: Components = {
  /**
   * `code` covers both inline spans and fenced blocks — the fence is the one
   * carrying a `language-*` class. Inline code stays inline so it can wrap
   * within a sentence; a fence becomes a full CodeBlock.
   */
  code({ className, children, ...props }) {
    const fence = /language-(\w+)/.exec(className ?? '')
    if (!fence) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      )
    }
    return (
      <CodeBlock
        code={textOf(children).replace(/\n$/, '')}
        language={resolveLanguage(fence[1])}
      />
    )
  },

  /**
   * react-markdown nests the fence inside a `pre`. CodeBlock brings its own
   * frame, so this unwraps rather than double-framing it.
   */
  pre({ children }) {
    return <>{children}</>
  },

  /**
   * Wide tables scroll inside their own bordered box instead of stretching the
   * message column. The wrapper owns the border and radius so the table itself
   * can stay a plain grid.
   */
  table({ children }) {
    return (
      <div className="my-4 max-w-full overflow-x-auto rounded-lg border border-border">
        <table>{children}</table>
      </div>
    )
  },

  /** External links open outside the app and never leak a referrer. */
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    )
  },
}
