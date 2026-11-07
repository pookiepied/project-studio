import type { ReplyNode } from './rehypeReply'

/**
 * The streaming caret, placed where the words actually end.
 *
 * It used to be a span after the whole rendered block. A paragraph is a block,
 * so the caret fell to its own line beneath the text and stayed there. This
 * pass walks down the last child of the tree instead and puts the caret beside
 * the last word, however deep the last word is.
 *
 * The walk decides by what it finds at the end:
 *
 *   containers   paragraphs, headings, lists and quotes: go on inside.
 *   inline       emphasis, links, inline code, maths: the caret follows it, so
 *                it never lands inside a chip or a link's label.
 *   anything else  a table, a code block, a chart, a picture, a rule: no caret
 *                at all. Those show their own progress or have no end of text
 *                to mark, and a blinking bar beside one says nothing.
 *
 * Runs last, after the sanitiser, so the class is this pass's and nothing model
 * output could request.
 */
const CONTAINERS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'blockquote'])
const INLINE = new Set(['a', 'abbr', 'b', 'code', 'del', 'em', 'i', 'kbd', 'mark', 's', 'span', 'strong', 'sub', 'sup', 'u'])

const CARET: ReplyNode = {
  type: 'element',
  tagName: 'span',
  properties: { className: ['studio-stream-caret', 'animate-pulse'], ariaHidden: 'true' },
  children: [],
}

const isBlank = (node: ReplyNode) => node.type === 'text' && (node.value ?? '').trim() === ''

/** The last child that is not whitespace, with its place among its siblings. */
function lastOf(node: ReplyNode): { child: ReplyNode; index: number } | null {
  const children = node.children ?? []
  for (let index = children.length - 1; index >= 0; index -= 1) {
    const child = children[index]
    if (child !== undefined && !isBlank(child)) return { child, index }
  }
  return null
}

function place(parent: ReplyNode): void {
  const last = lastOf(parent)
  if (last === null) return
  const { child, index } = last
  if (child.type === 'element' && CONTAINERS.has(child.tagName ?? '')) {
    place(child)
    return
  }
  if (child.type === 'text' || (child.type === 'element' && INLINE.has(child.tagName ?? ''))) {
    parent.children?.splice(index + 1, 0, CARET)
  }
}

export function rehypeCaret() {
  return (tree: ReplyNode) => place(tree)
}
