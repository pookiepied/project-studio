import { memo, type ReactNode } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { ArtifactBlock } from '@/features/artifacts'
import { CodeBlock, TEXT_FENCES, TextBlock } from '@/features/chat/markdown/blocks'

/**
 * Model output, rendered.
 *
 * ---- Why raw HTML is allowed, and why it is sanitised --------------------
 *
 * Models emit HTML, and refusing to render it means a reply that used a `<sub>`
 * or a small table shows its tags as text. So `rehype-raw` parses it -- and
 * `rehype-sanitize` immediately runs behind it, because model output is
 * untrusted content by the same rule that governs anything arriving from the
 * network. Without the sanitiser this pipeline would execute a `<script>` a
 * model was talked into emitting.
 *
 * The schema below is the default with two removals rather than a hand-built
 * allowlist: starting from a known-good policy and subtracting is safe, while
 * starting from nothing and adding is how a gap gets shipped.
 *
 * There is deliberately no iframe, object, embed, or form. Rendering a preview
 * of model-authored markup is a different product decision, and this is not it.
 *
 * ---- Why it is memoised ---------------------------------------------------
 *
 * The transcript re-renders on every streamed chunk. Without memo, every
 * finished message in the conversation re-parses its markdown on each tick,
 * which is what turns a smooth stream into a stutter partway down a long
 * conversation.
 */

const SCHEMA = {
  ...defaultSchema,
  tagNames: (defaultSchema.tagNames ?? []).filter(
    (tag) => tag !== 'iframe' && tag !== 'object' && tag !== 'embed' && tag !== 'form',
  ),
  attributes: {
    ...defaultSchema.attributes,
    // `remark-math` marks a formula by putting `math-inline` or `math-display`
    // on the node, and `rehype-katex` reads that class to decide which one to
    // render. The sanitiser runs in between and strips unlisted classes, so
    // without these two entries every display formula silently renders as
    // inline -- centred blocks collapse into the sentence above them.
    //
    // The values are listed explicitly rather than allowing `className`
    // outright. A bare allow would let model output carry any class it liked
    // into our stylesheet, which is a styling injection even though it is not a
    // scripting one.
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'math-inline', 'math-display']],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'math-inline', 'math-display']],
  },
}

const COMPONENTS: Components = {
  /**
   * Fenced code becomes a `CodeBlock`; inline code is left to the prose rules.
   *
   * `react-markdown` wraps a fence in a `<pre>`, so `pre` below unwraps it --
   * otherwise the block's own frame would nest inside a second one and inherit
   * the prose `<pre>` styling on top of its own.
   */
  code({ className, children, ...rest }) {
    // Not `\w+`. The info string may carry a path after the language --
    // ```ts:src/utils/get-diff.ts -- and `\w` stops dead at the colon, which
    // silently threw the filename away and left the block captioned
    // "TypeScript" like every other one.
    const fence = /language-([^\s"']+)/.exec(className ?? '')?.[1]
    const text = String(children).replace(/\n$/, '')

    if (fence === undefined) {
      return (
        <code className={className} {...rest}>
          {children}
        </code>
      )
    }

    // A fence carries three different intentions and they are three different
    // objects. `artifact` is structured output the model produced -- a search,
    // an image, an issue -- and is rendered as a thing rather than as its JSON.
    if (fence === 'artifact') return <ArtifactBlock source={text} />

    // Code, or a piece of writing made for you. See `TextBlock` for why a
    // rewrite should not be set as monospace.
    if (fence in TEXT_FENCES) return <TextBlock text={text} fence={fence} />

    return <CodeBlock code={text} fence={fence} />
  },

  pre({ children }) {
    return <>{children}</>
  },

  /**
   * Tables scroll inside their own frame.
   *
   * A wide table is the second thing after a code block that can stretch the
   * column, and the same `min-w-0` plus a scroller is the same fix.
   */
  table({ children }) {
    return (
      // The same card-and-panel construction the code block uses, for the same
      // reason: a table is a produced object, and the corners come from the
      // cells' own fills rather than from a wrapper clipping them.
      <div className="my-5 w-full min-w-0 rounded-block bg-surface-raised p-2 shadow-lifted">
        <div className="studio-scroll-x w-full min-w-0 overflow-x-auto rounded-block-inner bg-code-surface">
          <table>{children}</table>
        </div>
      </div>
    )
  },

  /** Links open outside the app; nothing in a transcript navigates the shell. */
  a({ href, children }) {
    return (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    )
  },
}

export const Markdown = memo(function Markdown({ text }: { text: string }): ReactNode {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeRaw, [rehypeSanitize, SCHEMA], rehypeKatex]}
      components={COMPONENTS}
    >
      {text}
    </ReactMarkdown>
  )
})
