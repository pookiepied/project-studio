/**
 * The structure a reply implies but Markdown cannot say: citations that point
 * at a numbered source list, and checklist items as marks rather than form
 * controls.
 *
 * ---- Citations ------------------------------------------------------------
 *
 * Models cite the way papers do: a bare `[1]` after a claim and a numbered
 * "Sources" list at the end. Markdown sees no link in `[1]` -- it is literal
 * bracket text -- so the reply showed raw brackets beside a list of raw URLs,
 * while the citation chip only ever appeared for the rare `[1](url)` form.
 * This pass reads the source list and links each marker to its entry, so the
 * marker becomes the same chip, with the same preview and explicit open.
 *
 * A marker is linked only when every number in it resolves. `[3]` in a reply
 * with two sources stays text: inventing a destination would be worse than
 * showing the bracket.
 *
 * ---- Checklists -----------------------------------------------------------
 *
 * remark-gfm renders `- [x]` as a disabled `<input type="checkbox">`, which is
 * the browser's own control drawn next to a list bullet. The input is replaced
 * by a drawn mark with its state stated in words, and `[~]` / `[-]` -- the
 * blocked convention models use, which GFM leaves as text -- joins the list as
 * a third state instead of a literal bracket.
 *
 * Runs after the sanitiser, so the classes it adds are its own rather than
 * anything model output could request.
 */

/** The slice of hast this pass walks, stated structurally (see `FenceNode`). */
export interface ReplyNode {
  type: string
  tagName?: string
  value?: string
  children?: ReplyNode[]
  properties?: Record<string, unknown>
}

export interface Source {
  readonly url: string
  readonly title: string
}

/** Sources by their number in the list. */
export type Sources = ReadonlyMap<number, Source>

const SOURCE_LABEL = /^(?:sources?|references?|citations?|bibliography|works cited|further reading)\s*:?$/i
/** A range is one marker; adjacent markers match separately. */
const MARKER = /\[(\d{1,3}(?:\s*[,\u2013-]\s*\d{1,3})*)\]/g
const WEB = /^https?:\/\//i
const SKIP = new Set(['a', 'code', 'pre', 'script', 'style'])

function isElement(node: ReplyNode | undefined, tag?: string): node is ReplyNode {
  return node?.type === 'element' && (tag === undefined || node.tagName === tag)
}

function textOf(node: ReplyNode): string {
  if (node.type === 'text') return node.value ?? ''
  return (node.children ?? []).map(textOf).join('')
}

function classesOf(node: ReplyNode): string[] {
  const value = node.properties?.className
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
}

function addClass(node: ReplyNode, name: string) {
  node.properties = { ...node.properties, className: [...classesOf(node), name] }
}

function firstLink(node: ReplyNode): ReplyNode | undefined {
  for (const child of node.children ?? []) {
    if (isElement(child, 'a') && typeof child.properties?.href === 'string' && WEB.test(child.properties.href)) return child
    const nested = firstLink(child)
    if (nested !== undefined) return nested
  }
  return undefined
}

/** The entry's own words, minus the URL printed after them: what the chip's preview calls the source. */
function titleOf(item: ReplyNode, link: ReplyNode): string {
  const url = String(link.properties?.href)
  const own = textOf(link).trim()
  const text = own !== url ? own : textOf(item).replace(url, '')
  return text.replace(/\s+/g, ' ').replace(/[\s.:,\u2013\u2014-]+$/, '').trim() || url
}

/**
 * The numbered list the markers refer to.
 *
 * A labelled list ("Sources", "References") wins, because that is the one the
 * writer meant; failing that, the last ordered list whose every entry carries a
 * web link, because a source list is the one list that is all destinations.
 */
function findSources(root: ReplyNode): { list: ReplyNode; sources: Map<number, Source> } | null {
  const found: { labelled: ReplyNode | null; fallback: ReplyNode | null } = { labelled: null, fallback: null }
  const visit = (parent: ReplyNode) => {
    const elements = (parent.children ?? []).filter((child) => isElement(child))
    elements.forEach((node, index) => {
      if (node.tagName === 'ol') {
        const items = (node.children ?? []).filter((child) => isElement(child, 'li'))
        if (items.length > 0 && items.every((item) => firstLink(item) !== undefined)) {
          const before = elements[index - 1]
          if (before !== undefined && SOURCE_LABEL.test(textOf(before).trim())) found.labelled = node
          found.fallback = node
        }
      }
      visit(node)
    })
  }
  visit(root)
  const list = found.labelled ?? found.fallback
  if (list === null) return null
  const start = Number(list.properties?.start ?? 1)
  const sources = new Map<number, Source>()
  ;(list.children ?? []).filter((child) => isElement(child, 'li')).forEach((item, index) => {
    const link = firstLink(item)
    if (link !== undefined) sources.set(start + index, { url: String(link.properties?.href), title: titleOf(item, link) })
  })
  return { list, sources }
}

function numbersIn(marker: string): number[] {
  return marker.split(/\s*,\s*/).flatMap((part) => {
    const range = /^(\d+)\s*[\u2013-]\s*(\d+)$/.exec(part)
    if (range === null) return [Number(part)]
    const [from, to] = [Number(range[1]), Number(range[2])]
    if (to < from || to - from > 20) return [Number.NaN]
    return Array.from({ length: to - from + 1 }, (_, offset) => from + offset)
  })
}

function citation(number: number, source: Source): ReplyNode {
  return {
    type: 'element',
    tagName: 'a',
    properties: { href: source.url, title: source.title },
    children: [{ type: 'text', value: String(number) }],
  }
}

/** Split a text node around resolvable markers; `null` when it has none. */
function linkMarkers(value: string, sources: Sources): ReplyNode[] | null {
  const out: ReplyNode[] = []
  let last = 0
  for (const match of value.matchAll(MARKER)) {
    const numbers = numbersIn(match[1] ?? '')
    if (!numbers.every((number) => sources.has(number))) continue
    // The space before a marker belongs to the sentence, not the chip: the
    // chip carries its own margin, and a space plus a margin reads as a gap.
    const before = value.slice(last, match.index).replace(/[ \t]+$/, '')
    if (before.length > 0) out.push({ type: 'text', value: before })
    for (const number of numbers) {
      const source = sources.get(number)
      if (source !== undefined) out.push(citation(number, source))
    }
    last = (match.index ?? 0) + match[0].length
  }
  if (last === 0) return null
  if (last < value.length) out.push({ type: 'text', value: value.slice(last) })
  return out
}

function citeWithin(node: ReplyNode, sources: Sources, list: ReplyNode | null) {
  if (node === list || !node.children) return
  node.children = node.children.flatMap((child) => {
    if (child.type === 'text') return linkMarkers(child.value ?? '', sources) ?? [child]
    if (isElement(child) && !SKIP.has(child.tagName ?? '')) citeWithin(child, sources, list)
    return [child]
  })
}

const BLOCKED = /^\s*\[[~-]\]\s+/

function mark(state: 'done' | 'open' | 'blocked'): ReplyNode {
  const label = { done: 'Done', open: 'Not done', blocked: 'Blocked' }[state]
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['studio-task-mark', `studio-task-${state}`], role: 'img', ariaLabel: label },
    children: [],
  }
}

/** The first text an item shows, which is where `[~]` sits -- possibly inside a `<p>` in a loose list. */
function leadingText(item: ReplyNode): ReplyNode | undefined {
  for (const child of item.children ?? []) {
    if (child.type === 'text') {
      if ((child.value ?? '').trim().length > 0) return child
      continue
    }
    if (isElement(child, 'p')) return leadingText(child)
    return undefined
  }
  return undefined
}

function checklists(node: ReplyNode) {
  for (const child of node.children ?? []) {
    if (!isElement(child)) continue
    if (child.tagName === 'ul' || child.tagName === 'ol') {
      let tasks = classesOf(child).includes('contains-task-list')
      for (const item of (child.children ?? []).filter((entry) => isElement(entry, 'li'))) {
        const holder = item.children?.[0] !== undefined && isElement(item.children[0], 'p') ? item.children[0] : item
        const box = holder.children?.findIndex((entry) => isElement(entry, 'input')) ?? -1
        if (box !== -1 && holder.children) {
          const done = Boolean(holder.children[box]?.properties?.checked)
          holder.children.splice(box, 1, mark(done ? 'done' : 'open'))
          if (done) addClass(item, 'studio-task-complete')
          continue
        }
        const lead = leadingText(item)
        if (lead !== undefined && BLOCKED.test(lead.value ?? '')) {
          lead.value = (lead.value ?? '').replace(BLOCKED, '')
          const into = holder.children ?? []
          into.unshift(mark('blocked'), { type: 'text', value: ' ' })
          holder.children = into
          if (!classesOf(item).includes('task-list-item')) addClass(item, 'task-list-item')
          tasks = true
        }
      }
      if (tasks && !classesOf(child).includes('contains-task-list')) addClass(child, 'contains-task-list')
    }
    checklists(child)
  }
}

const LIST_LINE = /^ {0,3}(\d{1,3})[.)]\s+(.*)$/
const URL_IN_LINE = /https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?]/

/**
 * The reply's source list, read from its Markdown.
 *
 * A streamed reply is rendered as separate blocks (`segment`), and the list is
 * almost always in a different block from the claims citing it -- it comes
 * last. So the whole reply is scanned once, here, and every block receives the
 * result. The rules are the tree pass's own: a labelled list wins, otherwise
 * the last numbered list whose every entry carries a web address.
 */
export function scanSources(text: string): Sources {
  interface Run { labelled: boolean; entries: Map<number, Source>; complete: boolean }
  const lists: Run[] = []
  let current: Run | null = null
  let previous = ''
  let fenced = false
  for (const line of text.split('\n')) {
    if (/^\s*(`{3,}|~{3,})/.test(line)) fenced = !fenced
    if (fenced) continue
    const item = LIST_LINE.exec(line)
    if (item !== null) {
      if (current === null) {
        const label = previous.replace(/[#*_`]/g, '').trim()
        current = { labelled: /^(?:sources?|references?|citations?|bibliography|works cited|further reading)\s*:?$/i.test(label), entries: new Map(), complete: true }
        lists.push(current)
      }
      const url = URL_IN_LINE.exec(item[2] ?? '')?.[0]
      if (url === undefined) current.complete = false
      else {
        const title = (item[2] ?? '')
          .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
          .replace(url, '')
          .replace(/[*_`<>]/g, '')
          .replace(/\s+/g, ' ')
          .replace(/[\s.:,\u2013\u2014-]+$/, '')
          .trim()
        current.entries.set(Number(item[1]), { url, title: title || url })
      }
    } else if (line.trim() !== '' && !/^\s{2,}\S/.test(line)) {
      current = null
    }
    if (line.trim() !== '') previous = line
  }
  const usable = lists.filter((list) => list.complete && list.entries.size > 0)
  const chosen = [...usable].reverse().find((list) => list.labelled) ?? usable.at(-1)
  return chosen?.entries ?? new Map()
}

/**
 * The rehype plugin: a transformer over the sanitised tree.
 *
 * `sources` is the whole reply's list (see `scanSources`); a list inside this
 * block is preferred, since it is the one the block's own markers were
 * written against.
 */
export function rehypeReply(options: { sources?: Sources } = {}) {
  return (tree: ReplyNode) => {
    const found = findSources(tree)
    if (found !== null) addClass(found.list, 'studio-sources')
    const sources = found?.sources ?? options.sources
    if (sources !== undefined && sources.size > 0) citeWithin(tree, sources, found?.list ?? null)
    checklists(tree)
  }
}
