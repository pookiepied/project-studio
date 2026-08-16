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
   * This object is where the content hierarchy is decided. Everything a reply
   * can contain arrives here as markdown, and each kind joins one of three
   * tiers -- never its own look. See "The content hierarchy" in `RULES.md` for
   * the reasoning; the routing is:
   *
   * - `artifact` fences and tables are *embedded* -- they sit on the sunken
   *   ground the integrations use, because they are the reply talking about
   *   something that happened elsewhere.
   * - code and writing-as-an-object fences are *previews* -- a `BlockFrame`
   *   with a cap and a copy button, because they are things the reader takes
   *   away rather than reads in place.
   * - everything else is prose and stays inline.
   *
   * Images and videos never pass through here; they are artifacts and render
   * independent of the text, at their own measure.
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
   * A table is embedded content, not a produced object.
   *
   * It rides on the same sunken ground the integrations use -- `ArtifactShell`'s
   * container, verbatim -- rather than in the code block's raised card, because
   * a table is the reply *about* something, the way a search result set is, and
   * not a thing you take away and use, the way code is. One rule for which
   * content gets which treatment; see "The content hierarchy" in `RULES.md`.
   *
   * A wide table is still the one thing after prose that can stretch the
   * column, so it scrolls inside itself on x -- the scroller is the ground's
   * own, and the cell fills carry the shape.
   */
  table({ children }) {
    return (
      <div className="studio-scroll-x my-5 w-full min-w-0 overflow-x-auto rounded-xl bg-surface-sunken p-3">
        <table>{children}</table>
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
