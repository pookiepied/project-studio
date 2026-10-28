import { createContext, memo, useContext, type ReactNode } from 'react'
import ReactMarkdown, { defaultUrlTransform, type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize'
import { ArtifactBlock } from '@/features/artifacts'
import { CodeBlock, TEXT_FENCES, TextBlock } from '@/features/chat/markdown/blocks'
import { useMath } from '@/features/chat/markdown/useMath'
import { MarkdownLink } from './MarkdownLink'
import { prepareMath } from './prepareMath'
import { rehypeReply, type Sources } from './rehypeReply'
import { VISUAL_FENCES, VisualBlock } from './visuals'
import { LOCAL_IMAGE, remarkReplyImages, ReplyImage } from './ReplyImage'

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
]

const SVG_ATTRIBUTES = [
  'd', 'fill', 'fill-opacity', 'fill-rule', 'stroke', 'stroke-width',
  'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray', 'stroke-opacity',
  'opacity', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry',
  'width', 'height', 'points', 'transform', 'viewBox', 'preserveAspectRatio',
  'xmlns', 'version', 'offset', 'stop-color', 'stop-opacity',
  'gradientUnits', 'gradientTransform', 'patternUnits', 'clip-rule',
  'text-anchor', 'dominant-baseline', 'font-size', 'font-family',
  'font-weight', 'role', 'aria-hidden', 'aria-label',
]

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
  },  // A local picture arrives as `studio-file:` (see `remarkReplyImages`); the
  // image component, not the webview, decides what that may load.
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src ?? []), LOCAL_IMAGE.slice(0, -1)],
  },
}

/** react-markdown's own URL filter, with the one scheme this file adds. */
function urlTransform(url: string): string {
  return url.startsWith(LOCAL_IMAGE) ? url : defaultUrlTransform(url)
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

const StreamingContext = createContext(false)
const UserContext = createContext(false)

function Fence({ node }: { node: FenceNode | undefined }) {
  const streaming = useContext(StreamingContext)
  const user = useContext(UserContext)
  const { fence, text } = fenceOf(node)
  if (fence === 'artifact') return user ? <TextBlock text={text} fence="text" /> : <ArtifactBlock source={text} />
  // A visual is drawn for a reply and shown as written in a person's own message.
  if (fence !== undefined && VISUAL_FENCES.has(fence)) {
    return user ? <TextBlock text={text} fence="text" /> : <VisualBlock fence={fence} source={text} streaming={streaming} />
  }
  if (fence === undefined || fence in TEXT_FENCES) return <TextBlock text={text} fence={fence ?? 'text'} />
  return <CodeBlock code={text} fence={fence} streaming={streaming} />
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
   * Generated images and videos are artifacts and render independent of the
   * text; a picture the reply itself embeds is drawn inline (`img`).
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
    return <Fence node={node} />
  },

  /** Inline code, and nothing else -- every fence was routed at `pre`. */
  code({ className, children, ...rest }) {
    const fileReference = typeof children === 'string'
      && (!/\s/.test(children) || /^(?:[A-Za-z]:[\\/]|\/|\.{1,2}[\\/])/.test(children))
      && /(?:^|[\\/])[^\\/\n]+\.(?:png|jpe?g|webp|gif|svg|avif|pdf|docx?|pptx?|xlsx?|csv|tsv|txt|md|py|[cm]?[jt]sx?|json|html?|css|rs|go|java|toml|ya?ml|sh|sql|mp4|webm|mp3|wav|ogg)(?::\d+(?::\d+)?)?$/i.test(children)
    return (
      <code className={fileReference ? 'studio-file-reference' : className} {...rest}>
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

  /** Inspect the destination before deliberately opening the OS browser. */
  /** Pictures are fetched through the harness, never by the webview (see `ReplyImage`). */
  img({ src, alt }) {
    return <ReplyImage src={typeof src === 'string' ? src : undefined} alt={alt} />
  },

  a({ href, title, children }) {
    return <MarkdownLink href={href} title={title} children={children} />
  },
}

export const Markdown = memo(function Markdown({ text, streaming = false, user = false, sources }: { text: string; streaming?: boolean; user?: boolean; sources?: Sources }): ReactNode {
  // The maths plugins join the pipeline only for a reply that carries a
  // formula, and only once they have arrived (`useMath`). The sanitiser
  // keeps its place between raw and katex either way.
  const math = useMath(text)
  const source = math === null ? text : prepareMath(text)
  const reply: [typeof rehypeReply, { sources?: Sources }] = [rehypeReply, { sources }]
  return (
    <UserContext.Provider value={user}><StreamingContext.Provider value={streaming}><ReactMarkdown
      skipHtml={user}
      remarkPlugins={math === null ? [remarkGfm, remarkReplyImages] : [remarkGfm, remarkReplyImages, math.remark]}
      urlTransform={urlTransform}
      rehypePlugins={
        user ? (math === null ? [reply] : [reply, math.rehype]) : math === null
          ? [rehypeRaw, [rehypeSanitize, SCHEMA], reply]
          : [rehypeRaw, [rehypeSanitize, SCHEMA], reply, math.rehype]
      }
      components={COMPONENTS}
    >
      {source}
    </ReactMarkdown></StreamingContext.Provider></UserContext.Provider>
  )
})
