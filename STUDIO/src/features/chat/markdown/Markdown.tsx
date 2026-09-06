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
 * or a small table shows its tags as text. So `rehype-raw` parses it — and
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

/**
 * The SVG the reply is allowed to draw.
 *
 * `rehype-raw` parses an inline `<svg>` and the sanitiser then removed it
 * whole -- `svg` is not in the default schema's tag list, so an illustration
 * the model wrote simply vanished from the page, which is why SVG looked
 * broken. The default refuses SVG because SVG can carry scripts; the honest
 * fix is a curated allowlist, not letting the whole vocabulary through:
 * drawing shapes and painting them, plus the gradients and clips that real
 * illustrations use. No `script`, no `foreignObject`, no event handlers, no
 * `href` -- nothing in the list can execute or point outward.
 *
 * Both spellings are listed because the HTML parser lowercases element names
 * (`<linearGradient>` arrives as `lineargradient`) while attribute matching
 * is by property name and stays camel-cased (`viewBox`).
 */
const SVG_TAGS = [
  'svg', 'g', 'defs', 'title', 'desc',
  'path', 'circle', 'ellipse', 'rect', 'line', 'polyline', 'polygon',
  // The gradient/clip names in both spellings: the HTML parser lowercases
  // element names, while some upstream tooling keeps the SVG camel case.
  'lineargradient', 'linearGradient', 'radialgradient', 'radialGradient',
  'stop', 'clippath', 'clipPath', 'mask', 'text', 'tspan',
] as const

const SVG_ATTRIBUTES = [
  'd', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity',
  'opacity', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'points', 'transform', 'viewBox', 'preserveAspectRatio',
  'xmlns', 'version', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'patternUnits', 'clip-rule',
  'text-anchor', 'dominant-baseline', 'font-size', 'font-family',
  'font-weight', 'role', 'aria-hidden', 'aria-label',
] as const

const SCHEMA = {
  ...defaultSchema,
  tagNames: [
    ...(defaultSchema.tagNames ?? []).filter(
      (tag) => tag !== 'iframe' && tag !== 'object' && tag !== 'embed' && tag !== 'form',
    ),
    ...SVG_TAGS,
  ],
  attributes: {
    ...defaultSchema.attributes,
    // `remark-math` marks a formula by putting `math-inline` or `math-display`
    // on the node, and `rehype-katex` reads that class to decide which one to
    // render. The sanitiser runs in between and strips unlisted classes, so
    // without these two entries every display formula silently renders as
    // inline — centred blocks collapse into the sentence above them.
    //
    // The values are listed explicitly rather than allowing `className`
    // outright. A bare allow would let model output carry any class it liked
    // into our stylesheet, which is a styling injection even though it is not a
    // scripting one.
    span: [...(defaultSchema.attributes?.span ?? []), ['className', 'math-inline', 'math-display']],
    div: [...(defaultSchema.attributes?.div ?? []), ['className', 'math-inline', 'math-display']],
    ...Object.fromEntries(
      SVG_TAGS.map((tag) => [tag, [...SVG_ATTRIBUTES, ['className', 'math-inline', 'math-display']]]),
    ),
  },
}

/**
 * The slice of the markdown tree the fence reader walks, stated structurally.
 * `hast` is react-markdown's own dependency, not this app's, so its types are
 * not importable from here -- and the reader needs exactly five fields.
 */
interface FenceNode {
  readonly type: string
  readonly tagName?: string
  readonly value?: string
  readonly children?: readonly FenceNode[]
  readonly properties?: Readonly<Record<string, unknown>>
}

/** The fence info and the raw text of a fenced block, read off the tree. */
function fenceOf(node: FenceNode | undefined): { fence: string | undefined; text: string } {
  const code = node?.children?.find(
    (child): child is FenceNode => child.type === 'element' && child.tagName === 'code',
  )
  if (code === undefined) return { fence: undefined, text: '' }
  const className: unknown = code.properties?.className
  const classes = Array.isArray(className)
    ? className.filter((entry): entry is string => typeof entry === 'string')
    : typeof className === 'string'
      ? className.split(/\s+/)
      : []
  // Not `\w+`. The info string may carry a path after the language —
  // ```ts:src/utils/get-diff.ts — and `\w` stops dead at the colon, which
  // silently threw the filename away and left the block captioned
  // "TypeScript" like every other one.
  const fence = /language-([^\s"']+)/.exec(classes.join(' '))?.[1]
  return { fence, text: textOf(code) }
}

function textOf(node: FenceNode): string {
  let text = ''
  for (const child of node.children ?? []) {
    if (child.type === 'text') text += child.value
    else if (child.type === 'element') text += textOf(child)
  }
  return text.replace(/\n$/, '')
}

const COMPONENTS: Components = {
  /**
   * This object is where the content hierarchy is decided. Everything a reply
   * can contain arrives here as markdown, and each kind joins one of three
   * tiers — never its own look. See "The content hierarchy" in `RULES.md` for
   * the reasoning; the routing is:
   *
   * - `artifact` fences and tables are *embedded* — they sit on the sunken
   *   ground the integrations use, because they are the reply talking about
   *   something that happened elsewhere.
   * - code and writing-as-an-object fences are *blocks* — the artifact
   *   container with the whole content shown and a copy button, because they
   *   are things the reader takes away or works in rather than reads past.
   * - everything else is prose and stays inline.
   *
   * Images and videos never pass through here; they are artifacts and render
   * independent of the text, at their own measure.
   *
   * ---- Why fences are routed at `pre`, not at `code` -----------------------
   *
   * react-markdown wraps every fence in a `<pre>` and marks the language with
   * a class on the inner `<code>` -- and an UNLABELED fence carries no class
   * at all, which is exactly how a plain ``` block reached the inline-code
   * chip styling and rendered as a grey pill the width of the column, or
   * seemed not to render as a block at all depending on what the model wrote.
   * Reading the fence off the hast node here means every fence has exactly
   * one fate, named or not, and the `code` component below is left with only
   * the inline case it can actually tell apart.
   */
  pre({ node }) {
    const { fence, text } = fenceOf(node)

    // `artifact` is structured output the model produced — a search, an
    // image, an issue — and is rendered as a thing rather than as its JSON.
    if (fence === 'artifact') return <ArtifactBlock source={text} />

    // Writing made for you -- named with one of the prose fences or, in the
    // common case, named with nothing at all. A fence that does not claim a
    // language is not claiming code either.
    if (fence === undefined || fence in TEXT_FENCES) {
      return <TextBlock text={text} fence={fence ?? 'text'} />
    }

    return <CodeBlock code={text} fence={fence} />
  },

  /** Inline code, and nothing else -- every fence was routed at `pre`. */
  code({ className, children, ...rest }) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    )
  },

  /**
   * A table is embedded content, not a produced object.
   *
   * It rides on the same sunken ground the artifacts use — `ArtifactShell`'s
   * container, verbatim — and, as in the aicss data table, the table fills
   * that ground edge to edge: the header band touches the frame's own
   * corners instead of floating inset inside padding, which is what made it
   * read as a centred bar that was never scaled to the box around it. The
   * inset belongs to the cells, not to the container.
   *
   * A wide table is still the one thing after prose that can stretch the
   * column, so it scrolls inside itself on x — the scroller is the ground's
   * own, and the header band carries the shape (the per-cell radius rules in
   * the stylesheet paint the corners, since a rounded wrapper clipping a
   * fill shears them on the pixel grid).
   */
  table({ children }) {
    return (
      <div className="studio-scroll-frame my-5 w-full min-w-0 overflow-x-auto rounded-xl bg-surface-sunken">
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
